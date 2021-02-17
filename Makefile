all: dist/index.js dist/index.html

watch:
	rollup -c -w

clean:
	rm -vR dist/*

dist/index.js: src/*.ts
	rollup -c

dist/index.html: src/index.html
	cp -v src/index.html dist/index.html

demo: dist/index.js dist/index.html
	cd dist && python3 -m http.server
