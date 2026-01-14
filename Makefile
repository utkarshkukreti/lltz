NAMES := timezones timezones-1970 timezones-now
VERSION := 2025c

_ = $(shell mkdir -p data)

all: $(NAMES:%=data/%.lltz)

data/%.lltz: data/%.geojson
	uv run src/build.py $< $@

data/%.geojson:
	curl -Lfs https://github.com/evansiroky/timezone-boundary-builder/releases/download/$(VERSION)/$*.geojson.zip > $@.zip
	unzip -p $@.zip > $@
	rm $@.zip

.SECONDARY:
