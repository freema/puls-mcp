export function loader() {
  return Response.json({
    name: 'puls-mcp-web',
    version: process.env.APP_VERSION || 'development',
    buildTime: process.env.BUILD_TIME || null,
  });
}
