# Atlas Junior

A mobile-friendly Next.js web app for kids to play Atlas on one phone or tablet.

## How it works

- The round starts with the letter **A**
- Each turn can use the microphone to hear the place name
- The heard text is shown on screen for the players to confirm or edit
- Saving a place moves the game to the next player and the next required letter
- The app tracks the round chain, scores, and repeated place names

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run lint
npm run build
```

## Deploy on Render

This repo includes a `render.yaml` blueprint for a Node web service.

1. Push the repo to GitHub
2. In Render, choose **New +** -> **Blueprint**
3. Select this repository
4. Render will use:

```bash
Build: npm install && npm run build
Start: npm run start -- --hostname 0.0.0.0 --port $PORT
```
