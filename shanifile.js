export default {
  options: {
    tests: "tests/*.test.js"
  },
  transpiler: {
    plugins: ateos.module.BABEL_PLUGINS,
    compact: false
  }
};
