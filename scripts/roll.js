const { readdirSync, statSync, readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');
const { builtinModules: BUILTIN_MODULES } = require('module');

const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const replace = require('@rollup/plugin-replace');
const esbuild = require('rollup-plugin-esbuild');
const { rollup } = require('rollup');
const toposort = require('toposort');

const PACKAGE_DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
];

const ENTRYPOINT = 'src/index.ts';
const CONFIGS = {
  // CJS for Node (.cjs)
  cjs: {
    prod: true,
    bundler: false,
    format: 'cjs',
    extname: '.cjs',
  },
  // ESM for bundlers (.mjs)
  esm: {
    prod: false,
    bundler: false,
    format: 'esm',
    extname: '.mjs',
  },
  // browser build IIFE (.global.js)
  global: {
    prod: true,
    bundler: true,
    format: 'iife',
    extname: '.global.js',
  },
  // bundled esm module (.module.js)
  module: {
    prod: true,
    bundler: true,
    format: 'esm',
    extname: '.module.js',
  },
};

function createConfig(opts) {
  // Unpack options
  const { name, dir, package, config, globals, external, version } = opts;
  const { prod, bundler: isBundled, format, extname } = config;

  const pkgName = package.name;
  const isProdBuild = !!prod;
  const isNodeBuild = format === 'cjs';
  const filename = pkgName.includes('@') ? pkgName.split('/', 2)[1] : pkgName;
  const resolvedExternal = [ ...BUILTIN_MODULES ];

  let resolvedGlobals = null;
  let extension = extname;
  if (isProdBuild) {
    // add .prod key before the last extension
    const extensions = extname.split('.');
    extensions.splice(-1, 0, 'prod');
    extension = extensions.join('.');
  }

  // replace with NODE_ENV for the bundler builds
  const replaceVariables = {
    __DEV__: isBundled ? JSON.stringify(isProdBuild) : '(process.env.NODE_ENV !== "production")',
  };

  // External modules should not be built
  if (isBundled) {
    if (format == 'iife') {
      // external only for global dependencies
      resolvedGlobals = globals;
      resolvedExternal.push(...Object.keys(globals));
    }

    // replace with NODE_ENV for the bundler builds, to tree shake env specific functionality
    replaceVariables['process.env.NODE_ENV'] = JSON.stringify(isProdBuild);
  } else {
    resolvedExternal.push(...external);
  }

  // Return rollup config
  return {
    input: {
      external: resolvedExternal,
      input: resolve(dir, ENTRYPOINT),
      plugins: [
        nodeResolve({ preferBuiltins: true }),
        commonjs({ sourceMap: false }),
        esbuild({
          tsconfig: resolve(__dirname, '../tsconfig.json'),
          sourceMap: false,
          minify: isProdBuild,
          // tree shake definitions in prod build
          define: {
            __BROWSER__: JSON.stringify(!isNodeBuild),
            __NODE_JS__: JSON.stringify(isNodeBuild),
            __VERSION__: JSON.stringify(version),
          },
          // Extra loaders
          loaders: {
            // Add .json files support
            '.json': 'json',
          },
        }),
        replace(replaceVariables),
      ],
      /*treeshake: {
        moduleSideEffects: false,
      },*/
      onwarn: (msg, warn) => !/Circular/.test(msg) && warn(msg),
    },
    output: {
      name, format, //plugins,
      globals: resolvedGlobals,
      exports: 'auto',
      file: resolve(dir, `dist/${filename}${extension}`),
      sourcemap: true,
      externalLiveBindings: false,
    },
  };
}

async function rollPackage(target, opts, packages) {
  const { formats, version } = opts;
  const { dir, package } = target;
  let { name, configs } = package.build;

  if (formats) {
    configs = configs.filter(key => formats.includes(key));
  }

  // resolve externals
  const peerDependencies = Object.keys(package.peerDependencies || {});
  const external = [
    ...Object.keys(package.dependencies || {}),
    ...peerDependencies,
  ];

  // resolve globals from peerDependencies
  const globals = peerDependencies.reduce((acc, name) => {
    const meta = packages.get(name);

    if (meta) {
      const { build } = meta.package;

      if (build.name) {
        acc[name] = build.name;
      }
    }

    return acc;
  }, {});


  const promises = configs
    .reduce((acc, key) => {
      const config = { ...CONFIGS[key] };
      const configOptions = { name, dir, package, config, external, globals, version };

      if (config.prod) {
        const devConfig = { ...config, prod: false };
        acc.push(createConfig({ ...configOptions, config: devConfig }));
      }

      acc.push(createConfig(configOptions));
      return acc;
    }, [])
    .map(({ input, output }) => {
      return rollup(input).then(bundle => bundle.write(output));
    });

  return Promise.all(promises);
}

function resolvePackages(rootDir, private = false, targets = null) {
  const packages = readdirSync(rootDir).reduce((acc, name) => {
    const dir = resolve(rootDir, name);
    const stats = statSync(dir);

    // Only publish directories with package.json set to public
    if (stats.isDirectory()) {
      const package = readPackage(dir);

      if (private || package.private !== true) {
        acc.push({ package, dir });
      }
    }

    return acc;
  }, []);

  // run topological sorting on the dependencies
  const edges = packages.map(({ package }) => {
    const deps = PACKAGE_DEP_KEYS.flatMap(key => {
      if (!package[key]) {
        return [];
      }

      return [ ...Object.keys(package[key]) ].filter(name => {
        return packages.find(p => name == p.package.name) != null;
      });
    });

    // should be safe, package can't be a dependency of itself after all
    return [ package.name, ...new Set(deps) ];
  });

  // order package by if it is used as a dependency in another package
  let ordered = toposort(edges)
      // somehow can include undefined due to edges not having any dependencies
    .filter(name => !!name)
    .reverse();

  // Only keep targeted packages and its peer dependencies (deep)
  // TODO: target an be a directory name too
  if (targets && targets.length) {
    targets = edges
      .map(e => e[0])
      .filter(e => targets.some(t => e.includes(t)));

    // checks if name has target as a dep or itself as a package name
    function hasDep(name, target) {
      if (name === target) {
        return true;
      }

      const deps = edges.find(x => x[0] == name);
      if (!deps) {
        return false;
      }

      return deps.slice(1).some(dep => hasDep(dep, target))
    }

    ordered = ordered.filter(name => {
      return targets.some(target => hasDep(target, name))
    });
  }

  // Array => Map of package metadata
  return ordered.reduce((acc, name) => {
    return acc.set(name, packages.find(p => name == p.package.name));
  }, new Map());
}

function readPackage(dir) {
  const data = readFileSync(resolve(dir, 'package.json'), 'utf8');
  return JSON.parse(data);
}

function writePackage(dir, data) {
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify(data), 'utf8');
}

exports.PACKAGE_DEP_KEYS = PACKAGE_DEP_KEYS;
exports.rollPackage = rollPackage;
exports.resolvePackages = resolvePackages;
exports.readPackage = readPackage;
exports.writePackage = writePackage;
