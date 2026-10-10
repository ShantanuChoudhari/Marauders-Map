# 🚀 Deploying Marauder's Map as a Public .io Web Game

This guide walks you through deploying **The Marauder's Map** as a live, multiplayer `.io` web game accessible by anyone worldwide on desktop and mobile.

---

## ⚡ Architecture Overview

The app is architected as a **unified production monolith**:
- **Frontend**: High-definition parchment canvas, Leaflet GPS navigation, Hogwarts House sorting, spellcasting hotbar, and the Dueling Club arena.
- **Backend**: Express REST API + Socket.IO real-time multiplayer server.
- **Production Mode**: The Express server automatically serves the compiled React app (`frontend/dist`) and Socket.IO events on the **exact same port and domain**. This means:
  - ✅ **Zero CORS issues**
  - ✅ **Instant WebSocket connections**
  - ✅ **Single-service deployment** (runs on 1 container or service, saving costs)
  - ✅ **Instant 1-Click Guest Access** (`.io` style: enter a name or click "Quick Play as Guest" and immediately start roaming & dueling)

---

## 🌐 Option 1: 1-Click Free Deployment on Render (Recommended)

[Render.com](https://render.com) offers free web services with automatic HTTPS, WebSocket support, and custom domain mapping.

### Steps:
1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Prepare production .io game deployment"
   git push origin main
   ```
2. **Sign up or log in to [Render.com](https://render.com)**.
3. Click **New +** ➡️ **Blueprint**.
4. Connect your GitHub repository.
5. Render will automatically read [`render.yaml`](./render.yaml) and configure:
   - **Build Command**: `npm ci && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. Click **Apply**.
7. In ~2 minutes, your game is live at `https://marauders-map-io.onrender.com`!

---

## 🚆 Option 2: Railway.app (Fastest Deployment)

[Railway.app](https://railway.app) automatically detects the included [`Dockerfile`](./Dockerfile).

### Steps:
1. Push your repository to GitHub.
2. Go to **[railway.app](https://railway.app)** and log in with GitHub.
3. Click **New Project** ➡️ **Deploy from GitHub repo**.
4. Select your `marauders-map` repository.
5. Railway will automatically build using [`Dockerfile`](./Dockerfile) and deploy.
6. Under **Settings** ➡️ **Networking**, click **Generate Domain** (or attach your `.io` domain).

---

## 🪰 Option 3: Fly.io (Global Edge Multiplayer)

[Fly.io](https://fly.io) runs Docker containers close to players worldwide for ultra-low latency.

### Steps:
1. Install Fly CLI: `powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"`
2. Log in: `fly auth login`
3. Launch:
   ```bash
   fly launch
   ```
   *(Select `fly.toml` when prompted)*
4. Deploy:
   ```bash
   fly deploy
   ```

---

## 🏷️ Connecting Your Custom `.io` Domain (e.g. `maraudersmap.io`)

Once deployed on **Render**, **Railway**, or **Fly.io**, you can point your purchased `.io` domain (from Namecheap, Porkbun, GoDaddy, or Cloudflare):

### 1. In Your Hosting Dashboard:
- **Render**: Go to your Web Service ➡️ **Settings** ➡️ **Custom Domains** ➡️ Add `yourgame.io` and `www.yourgame.io`.
- **Railway**: Go to Service ➡️ **Settings** ➡️ **Networking** ➡️ **Custom Domain**.

### 2. In Your DNS Provider (Namecheap / Porkbun / Cloudflare):
Add the following DNS records:

| Type | Host / Name | Value / Target | Notes |
| :--- | :--- | :--- | :--- |
| **CNAME** | `www` | `your-service.onrender.com` (or Railway domain) | Subdomain routing |
| **A** or **ANAME / ALIAS** | `@` | The IP address provided by Render/Railway | Root apex domain |

Render and Railway will automatically provision a **free SSL/TLS Certificate** via Let's Encrypt within 5–15 minutes.

---

## 🎮 How .io Instant Play Works

- **No barrier to entry**: Visitors arriving at your `.io` domain do not need to register with an email or password.
- Clicking **"Quick Cast as Guest Explorer (.io)"** automatically:
  1. Issues an instant cryptographic guest token.
  2. Generates an authentic wizard name (e.g., `CelestialWanderer#2892`, `SwiftMarauder#1044`).
  3. Sorts into a Hogwarts house and assigns an avatar.
  4. Drops the player right onto the living parchment map to duel bots (Voldemort, Dumbledore, Hermione, Ron, Ginny, Draco, Snape) or challenge live players!

---

## 🐳 Option 4: Deploying on a $4/mo VPS with Docker (DigitalOcean / Hetzner)

If you have a Linux VPS:
```bash
# 1. Clone repository
git clone https://github.com/your-username/marauders-map.git
cd marauders-map

# 2. Build and run Docker container
docker build -t marauders-map .
docker run -d -p 80:3000 --name marauders-map --restart unless-stopped marauders-map
```
Your game is immediately accessible at `http://your-server-ip/`!
