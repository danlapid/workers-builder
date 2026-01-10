/**
 * Fetches npm packages from esm.sh CDN.
 * esm.sh automatically bundles all transitive dependencies.
 */

export interface FetchResult {
  /** The bundled code from the CDN */
  code: string;
  /** The final URL after redirects */
  finalUrl: string;
}

/**
 * Fetch an npm package from esm.sh CDN.
 * The CDN automatically bundles all transitive dependencies.
 *
 * @param specifier - Package specifier (e.g., 'lodash', 'lodash@4.17.21', 'lodash/debounce')
 * @param cdnUrl - CDN base URL (default: 'https://esm.sh')
 * @returns The bundled code and final URL
 */
export async function fetchFromCDN(
  specifier: string,
  cdnUrl = 'https://esm.sh'
): Promise<FetchResult> {
  const url = `${cdnUrl}/${specifier}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch '${specifier}' from CDN: ${response.status} ${response.statusText}`
    );
  }

  const code = await response.text();

  return {
    code,
    finalUrl: response.url,
  };
}

/**
 * Resolve esm.sh relative imports to absolute URLs.
 * esm.sh returns code with relative imports like "/lodash@4.17.21/es2022/lodash.mjs"
 * which need to be resolved to full URLs.
 *
 * @param code - The code from esm.sh
 * @param cdnUrl - The base URL of the CDN
 * @returns Code with resolved import URLs
 */
export function resolveEsmShImports(code: string, cdnUrl = 'https://esm.sh'): string {
  // Match imports that start with / (esm.sh relative paths)
  // e.g., import "/lodash@4.17.21/es2022/lodash.mjs"
  return code.replace(
    /(import\s+(?:[\w*{}\s,]+\s+from\s+)?|export\s+(?:[\w*{}\s,]+\s+)?from\s+)(['"])(\/.+?)\2/g,
    (_match, prefix, quote, path) => {
      return `${prefix}${quote}${cdnUrl}${path}${quote}`;
    }
  );
}

/**
 * Parse package specifier into name and version
 */
export function parsePackageSpecifier(specifier: string): {
  name: string;
  version?: string;
  subpath?: string;
} {
  // Handle scoped packages (@scope/pkg)
  let name: string;
  let rest: string;

  if (specifier.startsWith('@')) {
    const slashIndex = specifier.indexOf('/', 1);
    if (slashIndex === -1) {
      return { name: specifier };
    }
    const secondSlash = specifier.indexOf('/', slashIndex + 1);
    if (secondSlash === -1) {
      name = specifier;
      rest = '';
    } else {
      name = specifier.slice(0, secondSlash);
      rest = specifier.slice(secondSlash + 1);
    }
  } else {
    const slashIndex = specifier.indexOf('/');
    if (slashIndex === -1) {
      name = specifier;
      rest = '';
    } else {
      name = specifier.slice(0, slashIndex);
      rest = specifier.slice(slashIndex + 1);
    }
  }

  // Check for version in name (e.g., lodash@4.17.21)
  const atIndex = name.lastIndexOf('@');
  if (atIndex > 0) {
    // Don't match leading @ in scoped packages
    const version = name.slice(atIndex + 1);
    name = name.slice(0, atIndex);
    if (rest) {
      return { name, version, subpath: rest };
    }
    return { name, version };
  }

  if (rest) {
    return { name, subpath: rest };
  }
  return { name };
}
