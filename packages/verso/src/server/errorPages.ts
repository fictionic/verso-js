const style = `
  body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 48px 64px; text-align: center; max-width: 480px; }
  h1 { font-size: 4rem; margin: 0 0 8px; color: #111; }
  p { color: #555; margin: 0 0 24px; }
  small { color: #aaa; font-size: 0.75rem; }
`;

export const html404 = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>404 Not Found</title><style>${style}</style></head>
<body><div class="box"><h1>404</h1><p>Page not found.</p><small>verso</small></div></body>
</html>`;

export const html500 = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>500 Internal Server Error</title><style>${style}</style></head>
<body><div class="box"><h1>500</h1><p>Something went wrong on the server.</p><small>verso</small></div></body>
</html>`;
