# minih — declarative agent runner

# Install all dependencies
install:
    npm install

# Build TypeScript → dist/
build:
    npm run build

# Run all tests
test:
    npm test

# Watch tests
test-watch:
    npm run test:watch

# Clean build artifacts
clean:
    npm run clean

# Build + test
check: build test

# Pack for npm (dry run)
pack:
    npm pack --dry-run
