NAMES := timezones timezones-1970 timezones-now
VERSION := 2026e

.PHONY: all

all: data/timezones.lltz

data/timezones.lltz: src/build.py uv.lock $(NAMES:%=data/$(VERSION)/%.geojson)
	uv run src/build.py $@ $(filter %.geojson,$^)

data/$(VERSION)/%.geojson:
	mkdir -p $(@D)
	curl -Lfs https://github.com/evansiroky/timezone-boundary-builder/releases/download/$(VERSION)/$*.geojson.zip > $@.zip
	unzip -p $@.zip > $@
	rm $@.zip

.DELETE_ON_ERROR:
