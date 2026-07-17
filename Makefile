.PHONY: build test lint typecheck clean dev install

build:
	npm run build

dev:
	npm run dev

test:
	npm run test

lint:
	npm run lint

typecheck:
	npm run typecheck

clean:
	npm run clean

install:
	npm install

check: typecheck lint test
	@echo "All checks passed"
