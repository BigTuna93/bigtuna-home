#!/bin/bash
# Checks that the TMDB and OMDb keys in config/keys.txt work. Prints no key values.
cd "$(dirname "$0")/.."
TMDB=$(sed -n 's/^TMDB_READ_TOKEN=//p' config/keys.txt | tr -d '[:space:]')
OMDB=$(sed -n 's/^OMDB_KEY=//p' config/keys.txt | tr -d '[:space:]')
t=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TMDB" "https://api.themoviedb.org/3/movie/550/watch/providers")
[ "$t" = 200 ] && echo "TMDB: working" || echo "TMDB: not working (code $t) - check you copied the long API Read Access Token"
o=$(curl -s "https://www.omdbapi.com/?i=tt0137523&apikey=$OMDB")
case "$o" in *'"Response":"True"'*) echo "OMDb: working ($(printf '%s' "$o" | grep -o '"Metascore":"[^"]*"'))";;
  *) echo "OMDb: not working - $(printf '%s' "$o" | grep -o '"Error":"[^"]*"') (did you click the activation link?)";; esac
