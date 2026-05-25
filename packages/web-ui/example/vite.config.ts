import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
	server: {
		proxy: {
			"/mock-api": {
				target: "http://localhost:18321",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/mock-api/, ""),
			},
		},
	},
	define: {
		"globalThis.__MOCK_API_BASE": JSON.stringify("http://localhost:5173/mock-api"),
	},
});
