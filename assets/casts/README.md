# assets/casts/

Demo cast files for arbiter docs and README.

## Pending

- `arbiter-init.cast` — `arbiter init` walkthrough (≤90s). Tracked in issue #530.
- `arbiter-init.mp4` — MP4 fallback rendered from cast (Twitter/LinkedIn). Tracked in issue #530.

## Recording notes (for #530)

```bash
# record in a clean container — no shell aliases, no personal config visible
asciinema rec arbiter-init.cast --title "arbiter init walkthrough"

# render MP4 fallback
# agg arbiter-init.cast arbiter-init.gif && ffmpeg -i arbiter-init.gif arbiter-init.mp4
```

Upload the `.cast` to asciinema.org and commit both files here.
