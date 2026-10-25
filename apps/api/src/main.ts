import { buildApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const app = buildApp();
app.listen({ port, host: '127.0.0.1' }).then(
  () => console.log(`brink api listening on http://127.0.0.1:${port}`),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
