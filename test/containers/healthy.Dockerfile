ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION
COPY healthy.mjs /app/healthy.mjs
CMD ["node", "healthy.mjs"]
