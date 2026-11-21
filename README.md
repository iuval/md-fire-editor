# FireMD Editor 🔥📝

A beautiful, fast Markdown editor built with **React + Vite + TypeScript** and synced via **Firebase**. Works offline with localStorage fallback, and syncs automatically when Firebase is configured.

## Features

- 📝 **Vditor** — WYSIWYG, Instant Rendering (Typora-like), and Split View modes
- 🔥 **Firebase Sync** — Real-time cloud sync with Firestore + anonymous auth
- 📱 **Responsive** — Desktop sidebar + mobile drawer
- 📴 **Offline-first** — Works without Firebase; localStorage backup
- ⚡ **PWA** — Installable on desktop and mobile
- 🌗 **Dark mode** — Automatic via `prefers-color-scheme`
- ⌨️ **Keyboard friendly** — Standard Markdown shortcuts via Vditor

## Editor Modes

Vditor supports three powerful editing modes:
- **WYSIWYG** — Rich text editing like Notion
- **Instant Rendering (IR)** — Type and see rendered Markdown immediately (like Typora)
- **Split View (SV)** — Classic side-by-side editor + preview

*(Defaults to IR on desktop, SV on mobile)*

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | React 19 + Vite 6 + TypeScript |
| Editor | [Vditor](https://github.com/Vanessa219/vditor) (11k+ ⭐) |
| Styling | Tailwind CSS v4 + CSS variables |
| Backend | Firebase Auth (anonymous) + Firestore |
| PWA | `vite-plugin-pwa` |

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd md-fire-editor
npm install
```

### 2. Configure Firebase

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Fill in your Firebase project credentials:

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

Get these from [Firebase Console](https://console.firebase.google.com/) → Project Settings → General → Your apps → SDK setup and configuration.

### 3. Run locally

```bash
npm run dev
```

### 4. Build for production

```bash
npm run build
```

The PWA-ready build will be in `dist/`.

## Firebase Setup (required for sync)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable **Firestore Database** (start in test mode for development)
4. Enable **Authentication** → Sign-in method → **Anonymous** (enable it)
5. Copy the web app config into `.env`

### Firestore Security Rules (for production)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/notes/{noteId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Architecture

```
src/
├── components/
│   ├── Header.tsx      # Top bar: title, sync status, new/delete
│   ├── Sidebar.tsx     # Note list (drawer on mobile)
│   └── Editor.tsx      # Vditor wrapper
├── hooks/
│   └── useFirebase.ts  # Auth + Firestore/localStorage abstraction
├── firebase.ts         # Firebase config + CRUD helpers
├── firebaseConfig.ts   # Reads env vars
└── App.tsx             # Main layout + debounced sync
```

## How Sync Works

1. **Local-first**: All notes are stored in `localStorage` if Firebase is not configured
2. **Debounced save**: Changes are synced to Firestore 1.5s after you stop typing
3. **Real-time**: If Firebase is active, `onSnapshot` keeps all clients in sync
4. **Offline resilience**: If the network drops, notes stay editable locally; sync resumes when online

## Deployment

This is a static SPA. Deploy to:
- **Vercel**: `vercel --prod`
- **Netlify**: Drag `dist/` to deploy
- **Firebase Hosting**: `firebase deploy`
- **GitHub Pages**: Use `gh-pages` branch from `dist/`

## License

MIT
