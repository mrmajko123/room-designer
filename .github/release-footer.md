
### Which file should I download?

| Device | File | Good to know |
| --- | --- | --- |
| Windows 10 / 11 | `Room-Designer-Setup-…-Windows-x64.exe` | The installer isn't code-signed yet, so Windows may say "Windows protected your PC". Click **More info → Run anyway**. When you first scan with your phone, allow Room Designer on **private networks**. |
| Mac with Apple chip (M1 and newer) | `Room-Designer-…-macOS-arm64.dmg` | Drag Room Designer to Applications. The app isn't signed by Apple, so run `xattr -cr "/Applications/Room Designer.app"` once in Terminal, then open it. |
| Mac with Intel chip | `Room-Designer-…-macOS-x64.dmg` | Same as above. |
| Linux | `Room-Designer-…-Linux-x86_64.AppImage` (any distro) or `…-Linux-amd64.deb` (Ubuntu, Debian, Mint) | For the AppImage: `chmod +x Room-Designer-*.AppImage`, then run it. |
| Android | `Room-Designer-…-Android.apk` | Open the file on your phone and allow "Install unknown apps" when asked. |
| iPhone / iPad | `Room-Designer-…-iPhone-unsigned.ipa` | Apple requires signing: install it with your Apple ID using AltStore or Sideloadly. |
| Any computer, no install | `Room-Designer-…-Web.zip` | Unzip it and open `index.html` in Chrome, Edge or Firefox. |

The Mac and iPhone files are added a little after the others, once their builds finish.

**Ready-made rooms**: `My-attic-room.room` opens in Room Designer (Your rooms → Open room file); it is also under Your rooms → New room. `My-attic-room.glb` is the 3D model for any 3D viewer, and `My-attic-room-preview.png` shows what it looks like.

**Scanning your things with your phone** works from the desktop app: click *Add → My stuff → Scan my stuff → Scan with your phone*, then scan the QR code with your phone (same Wi-Fi). Your rooms, photos and scans stay on your device.
