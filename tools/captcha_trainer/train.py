"""
Fast training & ONNX export script for TaxRecord 5-character CAPTCHA OCR.
"""
import os
import sys
import time
import random
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

from generator import CHARSET, WIDTH, HEIGHT, CAPTCHA_LEN, generate_fast_captcha

CHAR_TO_IDX = {ch: i for i, ch in enumerate(CHARSET)}
IDX_TO_CHAR = {i: ch for i, ch in enumerate(CHARSET)}
NUM_CLASSES = len(CHARSET)  # 36


class FastCaptchaDataset(Dataset):
    def __init__(self, size=10000):
        self.size = size
        self.samples = []
        t0 = time.time()
        for _ in range(size):
            arr, label, _ = generate_fast_captcha()
            target = [CHAR_TO_IDX[c] for c in label]
            self.samples.append((arr, target, label))
        print(f"Dataset generated: {size} samples in {time.time() - t0:.2f}s.")

    def __len__(self):
        return self.size

    def __getitem__(self, idx):
        arr, target, label = self.samples[idx]
        tensor = torch.from_numpy(arr).unsqueeze(0)  # [1, 38, 150]
        target_tensor = torch.tensor(target, dtype=torch.long)
        return tensor, target_tensor, label


class CaptchaCNN(nn.Module):
    def __init__(self, num_classes=NUM_CLASSES, seq_len=CAPTCHA_LEN):
        super(CaptchaCNN, self).__init__()
        self.seq_len = seq_len
        self.num_classes = num_classes

        # Feature extractor backbone
        self.conv1 = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.SiLU(),
            nn.MaxPool2d(2, 2)  # [32, 19, 75]
        )
        self.conv2 = nn.Sequential(
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.SiLU(),
            nn.MaxPool2d(2, 2)  # [64, 9, 37]
        )
        self.conv3 = nn.Sequential(
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.SiLU(),
            nn.MaxPool2d((2, 1), (2, 1))  # [128, 4, 37]
        )
        self.conv4 = nn.Sequential(
            nn.Conv2d(128, 256, kernel_size=3, padding=1),
            nn.BatchNorm2d(256),
            nn.SiLU(),
            nn.AdaptiveAvgPool2d((2, 10))  # [256, 2, 10] = 5120 features
        )

        self.fc = nn.Sequential(
            nn.Flatten(),
            nn.Linear(256 * 2 * 10, 512),
            nn.LayerNorm(512),
            nn.SiLU(),
            nn.Dropout(0.15),
            nn.Linear(512, seq_len * num_classes)
        )

    def forward(self, x):
        f = self.conv1(x)
        f = self.conv2(f)
        f = self.conv3(f)
        f = self.conv4(f)
        out = self.fc(f)
        return out.view(-1, self.seq_len, self.num_classes)  # [B, 5, 36]
def train():
    num_threads = min(8, os.cpu_count() or 4)
    torch.set_num_threads(num_threads)
    device = torch.device('cpu')
    print(f"Training on CPU ({num_threads} threads)...")

    train_size = 12000
    val_size = 1000
    train_dataset = FastCaptchaDataset(size=train_size)
    val_dataset = FastCaptchaDataset(size=val_size)

    train_loader = DataLoader(train_dataset, batch_size=64, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_dataset, batch_size=64, shuffle=False)

    model = CaptchaCNN().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=3.5e-3, weight_decay=1e-4)
    epochs = 4
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    best_val_acc = 0.0
    print("\n--- Starting Training ---")

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        correct_exact = 0
        total_samples = 0

        t_start = time.time()
        for x, y, labels in train_loader:
            optimizer.zero_grad()
            out = model(x)

            loss = 0
            for pos in range(CAPTCHA_LEN):
                loss += criterion(out[:, pos, :], y[:, pos])

            loss.backward()
            optimizer.step()
            total_loss += loss.item()

            preds = out.argmax(dim=-1)
            matches = (preds == y).all(dim=-1).sum().item()
            correct_exact += matches
            total_samples += x.size(0)

        scheduler.step()
        train_acc = correct_exact / total_samples * 100.0
        avg_loss = total_loss / len(train_loader)

        # Validation
        model.eval()
        val_correct_exact = 0
        val_total = 0
        with torch.no_grad():
            for x, y, labels in val_loader:
                out = model(x)
                preds = out.argmax(dim=-1)
                matches = (preds == y).all(dim=-1).sum().item()
                val_correct_exact += matches
                val_total += x.size(0)

        val_acc = val_correct_exact / val_total * 100.0
        elapsed = time.time() - t_start
        print(f"Epoch {epoch:02d}/{epochs:02d} [{elapsed:.1f}s] - Loss: {avg_loss:.4f} | Train Exact: {train_acc:.2f}% | Val Exact: {val_acc:.2f}%")

        if val_acc > best_val_acc:
            best_val_acc = val_acc

    # Export to ONNX
    os.makedirs('resources/models', exist_ok=True)
    onnx_path = 'resources/models/tax_captcha.onnx'
    model.eval()
    dummy_input = torch.randn(1, 1, HEIGHT, WIDTH, device=device)

    print(f"\nExporting PyTorch model to ONNX: {onnx_path}...")
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
    )

    file_size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"Model exported successfully! File size: {file_size_mb:.2f} MB")

    # Verify with onnxruntime in Python
    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path)

    test_correct = 0
    test_total = 100
    for _ in range(test_total):
        arr, true_lbl, _ = generate_fast_captcha()
        inp = np.expand_dims(np.expand_dims(arr, 0), 0)
        out = sess.run(None, {'input': inp})[0]  # [1, 5, 36]
        pred_idx = np.argmax(out[0], axis=-1)
        pred_txt = ''.join([IDX_TO_CHAR[i] for i in pred_idx])
        if pred_txt == true_lbl:
            test_correct += 1

    print(f"ONNX Test Set Accuracy (100 random captchas): {test_correct}/{test_total} ({test_correct}% Exact Match)")


if __name__ == '__main__':
    train()
