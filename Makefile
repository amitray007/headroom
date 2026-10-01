.PHONY: check docs
check: docs
	bun run check
docs:
	python3 scripts/check_docs.py
