ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION
CMD ["node", "-e", "process.exit(1)"]
