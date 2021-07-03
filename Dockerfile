FROM denoland/deno:alpine-1.11.4 AS build

COPY ./main.ts /tmp/build/
COPY ./import_map.json /tmp/build/
COPY ./lib /tmp/build/lib

WORKDIR /tmp/build

RUN deno bundle --unstable --import-map=import_map.json main.ts bundle.ts

FROM denoland/deno:alpine-1.11.4

COPY --from=build /tmp/build/bundle.ts /opt/place-whatever/bundle.ts

ENV CACHE_PATH=/tmp/imagecache
ENV IMAGE_REPOSITORY=/var/imagerepo

VOLUME /var/imagerepo

WORKDIR /opt/place-whatever

EXPOSE 8080

CMD [ \
  "deno", \
  "run", \
  "--unstable", \
  "--allow-net", \
  "--allow-read", \
  "--allow-write", \
  "--allow-env", \
  "--no-check", \
  "bundle.ts" \
]
