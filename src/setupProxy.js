const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/tiktok-api',
    createProxyMiddleware({
      target: 'https://live-backstage.tiktok.com',
      changeOrigin: true,
      pathRewrite: {
        '^/tiktok-api': '', // Remove /tiktok-api from the URL when sending to TikTok
      },
      onProxyReq: (proxyReq) => {
        // Spoof headers to look like a legitimate browser request from TikTok's domain
        proxyReq.setHeader('Referer', 'https://live-backstage.tiktok.com/portal/overview');
        proxyReq.setHeader('Origin', 'https://live-backstage.tiktok.com');
        proxyReq.setHeader('Host', 'live-backstage.tiktok.com');
        // We do NOT set cookies here; they are passed from the frontend fetch
      },
      onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        res.status(500).send('Proxy Error');
      }
    })
  );
};