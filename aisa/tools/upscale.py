"""Upscale the original drawing 4x before it is cut into parts.

  python3 upscale.py ../art/source.png RealESRGAN_x4plus_anime_6B.pth up4.png

The drawing is 224x512. Cut and stretched at that size, every line is a
blur of a pixel or two and every mesh bend smears it further; tracing it to
vectors instead broke its one-pixel lines into dashes. Real-ESRGAN's anime
model redraws it at 896x2048 with clean edges and the same colours, and
that is what tools/cut.py slices.

Build-time only, never shipped: needs torch, numpy and Pillow, and the
model weights from
https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth
The network is written out here rather than imported from basicsr, which
pins old versions of everything it touches.
"""
import sys
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image


class RDB(nn.Module):
    def __init__(s, nf=64, gc=32):
        super().__init__()
        s.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
        s.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
        s.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
        s.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
        s.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)
        s.lrelu = nn.LeakyReLU(0.2, True)

    def forward(s, x):
        x1 = s.lrelu(s.conv1(x))
        x2 = s.lrelu(s.conv2(torch.cat((x, x1), 1)))
        x3 = s.lrelu(s.conv3(torch.cat((x, x1, x2), 1)))
        x4 = s.lrelu(s.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = s.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(s, nf, gc=32):
        super().__init__()
        s.rdb1, s.rdb2, s.rdb3 = RDB(nf, gc), RDB(nf, gc), RDB(nf, gc)

    def forward(s, x):
        return s.rdb3(s.rdb2(s.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    """The 6-block variant the anime weights were trained for."""
    def __init__(s, nb=6, nf=64, gc=32):
        super().__init__()
        s.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
        s.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
        s.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
        s.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
        s.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
        s.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
        s.conv_last = nn.Conv2d(nf, 3, 3, 1, 1)
        s.lrelu = nn.LeakyReLU(0.2, True)

    def forward(s, x):
        f = s.conv_first(x)
        f = f + s.conv_body(s.body(f))
        f = s.lrelu(s.conv_up1(F.interpolate(f, scale_factor=2, mode='nearest')))
        f = s.lrelu(s.conv_up2(F.interpolate(f, scale_factor=2, mode='nearest')))
        return s.conv_last(s.lrelu(s.conv_hr(f)))


def main(src, weights, out):
    net = RRDBNet()
    sd = torch.load(weights, map_location='cpu')
    sd = sd.get('params_ema', sd.get('params', sd))
    net.load_state_dict(sd, strict=True)
    net.eval()
    img = np.array(Image.open(src).convert('RGB')).astype(np.float32) / 255
    x = torch.from_numpy(img).permute(2, 0, 1)[None]
    with torch.no_grad():
        y = net(x).clamp(0, 1)[0].permute(1, 2, 0).numpy()
    Image.fromarray((y * 255 + 0.5).astype(np.uint8)).save(out)
    print(out, y.shape[1], 'x', y.shape[0])


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
