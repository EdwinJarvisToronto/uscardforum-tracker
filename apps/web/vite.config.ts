import { defineConfig } from "vite";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "inject-production-csp",
      transformIndexHtml(html, context) {
        if (context.server) return html;
        return html.replace(
          "<!-- production-csp -->",
          `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">`,
        );
      },
    },
  ],
  server: {
    port: 5173,
  },
});
