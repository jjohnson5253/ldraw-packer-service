# LDraw Packer Service

A Railway function that provides an HTTP API for packing LDraw models.

## Endpoints

### Health Check
```
GET /health
```
Returns service status and LDraw library information.

### Pack Model
```
POST /pack
```
Pack an LDraw model file. Accepts:
- File upload via multipart/form-data
- Raw text content with `x-filename` header

Returns packed model content in MPD format.

## Usage

The service automatically downloads and sets up the LDraw parts library on first startup.

Example usage:
```bash
curl -X POST -F "model=@your-model.ldr" https://your-service-url/pack
```

Or with raw content:
```bash
curl -X POST -H "Content-Type: text/plain" -H "x-filename: model.ldr" \
  --data-binary @your-model.ldr https://your-service-url/pack
```