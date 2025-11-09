# ClosedBridge VPS Installation Guide

## 📋 Requirements

- **VPS Provider**: DigitalOcean, AWS, Vultr, Linode, etc.
- **OS**: Ubuntu 22.04, 24.04, or 25.04
- **RAM**: Minimum 1GB (2GB recommended)
- **Storage**: Minimum 10GB
- **Ports**: 3000, 22

## 🚀 One-Command Installation

### Step 1: SSH into your VPS
```bash
ssh root@YOUR_VPS_IP
```

### Step 2: Download and run the installer
```bash
curl -o vps-install.sh https://raw.githubusercontent.com/x8080x2/L1n7k/main/vps-install.sh && chmod +x vps-install.sh && bash vps-install.sh
```

**Or download manually:**
```bash
wget https://raw.githubusercontent.com/x8080x2/L1n7k/main/vps-install.sh
chmod +x vps-install.sh
sudo bash vps-install.sh
```

### Step 3: Enter your details when prompted
- **Telegram Bot Token**: Get it from [@BotFather](https://t.me/BotFather) (or press Enter to skip)
- The script will auto-detect your VPS IP

### Step 4: Wait for installation (2-5 minutes)

## ✅ What Gets Installed

- ✅ Node.js v20
- ✅ PM2 (process manager)
- ✅ Chromium browser + all dependencies
- ✅ ClosedBridge application
- ✅ Firewall configuration (ports 22, 3000)
- ✅ Auto-start on reboot

## 🌐 Access Your Installation

After installation completes:

**Main Application:**
```
http://YOUR_VPS_IP:3000
```

**Admin Panel:**
```
http://YOUR_VPS_IP:3000/ad.html
```

## 🤖 Telegram Bot Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Copy your bot token
3. Add to `.env` file or during installation
4. Send `/start` to your bot to get admin token

## 📊 Useful Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs closedbridge

# Restart application
pm2 restart closedbridge

# Stop application
pm2 stop closedbridge

# View real-time logs
pm2 logs closedbridge --lines 50
```

## 🔧 Manual Configuration

If you need to update settings later:

```bash
cd /root/closedbridge
nano .env
pm2 restart closedbridge --update-env
```

## 🔄 Updating ClosedBridge

```bash
cd /root/closedbridge
git pull origin main
npm install
pm2 restart closedbridge
```

## 🐛 Troubleshooting

**Check if Chromium is working:**
```bash
/usr/bin/chromium-browser --version
```

**Check firewall:**
```bash
ufw status
```

**Check PM2 logs for errors:**
```bash
pm2 logs closedbridge --err
```

**Reinstall:**
```bash
pm2 delete closedbridge
rm -rf /root/closedbridge
bash vps-install.sh
```

## 📞 Support

For issues, check the logs first:
```bash
pm2 logs closedbridge --lines 100
```

---

**Installation Time**: ~3-5 minutes  
**Tested on**: Ubuntu 22.04, 24.04, 25.04  
**Architecture**: x86_64
