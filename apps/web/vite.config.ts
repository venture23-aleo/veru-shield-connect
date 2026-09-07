import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // The dev-signer prefill (.env.local, written by `pnpm run web:devenv`) is a
  // DEV-SERVER convenience only. Production builds force these to empty so a
  // testnet key can never ride along inside dist/ — even when .env.local exists.
  define:
    mode === "production"
      ? {
          "import.meta.env.VITE_DEV_SIGNER_ADDRESS": JSON.stringify(""),
          "import.meta.env.VITE_DEV_SIGNER_KEY": JSON.stringify(""),
        }
      : {},
}));
