Cloudflare shipped Worker Loader binding and I have private beta access.
See the docs in <https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/>

The API is very low level and provides ways to pass in modules.
i.e.

```js
let worker = env.LOADER.get(id, async () => {
  return {
    mainModule: "foo.js",
    modules: {
      "foo.js":
        "export default {\n" +
        "  fetch(req, env, ctx) { return new Response('Hello'); }\n" +
        "}\n",
    },
    compatibilityDate: "2026-06-01",
    env: {
      SOME_ENV_VAR: 123
    },
    globalOutbound: null,
  };
});
```

I want to make it easier to generate the `mainModule` and `modules` argument when what you really have is just a source directory.
That means that we need to do package resolution and maybe even bundling in our code.
I want to create the following interface:

```js
let worker = env.LOADER.get(id, async () => {
  const { mainModule, modules } = await createWorker({
    files: {
      "src/index.ts": "export const hello = 'world';",
      "package.json": '{"name": "my-project"}',
    },
  });
  return {
    mainModule: mainModule,
    modules: modules,
    compatibilityDate: "2026-06-01",
    env: {
      SOME_ENV_VAR: 123
    },
    globalOutbound: null,
  };
});
```

The local directory should be the source directory for this work and where we can demo everything we want to build.
When looking for structure please use "../worker-fs-mount" directory as reference for how to structure the code and which tools to use for linting/ci/etc.

The key detail here is that it all has to be done within the worker, with respect to workers memory and ecosystem constraints.
We cannot spawn bash tools, we cannot use nodejs, we cannot use any external tools.
That being said, we do want to resuse as much code as possible so we can definitely take in dependencies from npm.
Let's try to scour what's possible and what exists first and what we can reuse.
I want to start with a long exploration first including experimentation and trial and error to eventually come up with a plan.