# AccessFlow (Hackathon Starter)

A Chrome extension side panel that applies **inclusive-design** accessibility improvements to **any website**:
- ✅ Inclusive Mode (bigger text, bigger buttons, more whitespace, reduced motion)
- 🎯 Focus Mode (hide clutter, highlight main content)
- 🧭 Task Tunnel (step-by-step form navigation)

## Quick Start (Local)
1. Download this folder.
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select this folder
5. Open any website → click the extension icon → side panel opens

## Demo Tips
- Try on a cluttered news site, an e-commerce page, and a long form.
- Show a **before/after** of Inclusive Mode, then use Task Tunnel to walk a form.

## Commands (Optional)
In the side panel command box:
- `highlight search`
- `click login`
- `type email john@example.com`
- `next` / `prev` (when Task Tunnel is active)

## License
MIT


## Side Panel Troubleshooting
If you see `Cannot read properties of undefined (reading 'open')`, add the `sidePanel` permission in `manifest.json` and reload the extension.
