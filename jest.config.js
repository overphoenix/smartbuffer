module.exports = {
  preset: "ts-jest",
	verbose: true,
	testTimeout: 60000,
  testEnvironment: "node",
  transform: {
    "^.+\\.(t|j)sx?$": ["@swc/jest"],
  },
};
