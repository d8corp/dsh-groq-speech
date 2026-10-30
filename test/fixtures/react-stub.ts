/**
 * Empty stand-in for the host-provided React in Node tests.
 *
 * React reaches the client through the DSH ModuleLoader at runtime and is not
 * a project dependency, so jest cannot resolve the real package.
 */
export {}
