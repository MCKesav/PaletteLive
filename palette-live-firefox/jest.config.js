/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    coverageDirectory: 'coverage',
    collectCoverageFrom: ['utils/**/*.js', 'content/shadowWalker.js', 'content/injector.js', '!utils/constants.js'],
};
