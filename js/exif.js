// Minimal self-contained EXIF parser: extracts GPS lat/lon/altitude and
// DateTimeOriginal from a JPEG File/Blob. No external dependency, so it
// keeps working fully offline once the app shell is cached.
//
// Returns null if the file isn't a JPEG or has no EXIF/GPS block.

const EXIF_TAGS = {
  DATE_TIME_ORIGINAL: 0x9003,
  GPS_IFD_POINTER: 0x8825,
  EXIF_IFD_POINTER: 0x8769,
};

const GPS_TAGS = {
  GPSLatitudeRef: 0x1,
  GPSLatitude: 0x2,
  GPSLongitudeRef: 0x3,
  GPSLongitude: 0x4,
  GPSAltitudeRef: 0x5,
  GPSAltitude: 0x6,
};

async function parseExifGps(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0, false) !== 0xffd8) return null; // not a JPEG

    let offset = 2;
    let exifBuf = null;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset, false);
      if (marker === 0xffe1) {
        const size = view.getUint16(offset + 2, false);
        const start = offset + 4;
        if (
          view.getUint32(start, false) === 0x45786966 &&
          view.getUint16(start + 4, false) === 0x0000
        ) {
          exifBuf = { start: start + 6, size: size - 8 };
        }
        break;
      } else if ((marker & 0xff00) !== 0xff00) {
        break;
      } else {
        offset += 2 + view.getUint16(offset + 2, false);
      }
    }
    if (!exifBuf) return null;

    const tiffStart = exifBuf.start;
    const little = view.getUint16(tiffStart, false) === 0x4949;
    const firstIfdOffset = view.getUint32(tiffStart + 4, little);

    function readIfd(ifdOffset) {
      const entries = view.getUint16(tiffStart + ifdOffset, little);
      const tags = {};
      for (let i = 0; i < entries; i++) {
        const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
        const tag = view.getUint16(entryOffset, little);
        const type = view.getUint16(entryOffset + 2, little);
        const count = view.getUint32(entryOffset + 4, little);
        const valueOffset = entryOffset + 8;
        tags[tag] = { type, count, valueOffset };
      }
      return tags;
    }

    function typeSize(type) {
      return { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 9: 4, 10: 8 }[type] || 1;
    }

    function readValue(entry) {
      const totalSize = typeSize(entry.type) * entry.count;
      const dataOffset =
        totalSize > 4
          ? tiffStart + view.getUint32(entry.valueOffset, little)
          : entry.valueOffset;

      if (entry.type === 2) {
        // ASCII string
        let str = "";
        for (let i = 0; i < entry.count - 1; i++) {
          str += String.fromCharCode(view.getUint8(dataOffset + i));
        }
        return str;
      }
      if (entry.type === 5) {
        // rational (unsigned) — used for GPS coords
        const out = [];
        for (let i = 0; i < entry.count; i++) {
          const num = view.getUint32(dataOffset + i * 8, little);
          const den = view.getUint32(dataOffset + i * 8 + 4, little);
          out.push(den === 0 ? 0 : num / den);
        }
        return entry.count === 1 ? out[0] : out;
      }
      if (entry.type === 1) {
        return view.getUint8(dataOffset);
      }
      if (entry.type === 3) {
        return view.getUint16(dataOffset, little);
      }
      if (entry.type === 4) {
        return view.getUint32(dataOffset, little);
      }
      return null;
    }

    const ifd0 = readIfd(firstIfdOffset);
    let dateTimeOriginal = null;
    if (ifd0[EXIF_TAGS.EXIF_IFD_POINTER]) {
      const exifIfdOffset = view.getUint32(
        ifd0[EXIF_TAGS.EXIF_IFD_POINTER].valueOffset,
        little
      );
      const exifIfd = readIfd(exifIfdOffset);
      if (exifIfd[EXIF_TAGS.DATE_TIME_ORIGINAL]) {
        dateTimeOriginal = readValue(exifIfd[EXIF_TAGS.DATE_TIME_ORIGINAL]);
      }
    }

    if (!ifd0[EXIF_TAGS.GPS_IFD_POINTER]) {
      return dateTimeOriginal ? { dateTimeOriginal } : null;
    }

    const gpsIfdOffset = view.getUint32(
      ifd0[EXIF_TAGS.GPS_IFD_POINTER].valueOffset,
      little
    );
    const gps = readIfd(gpsIfdOffset);

    function dmsToDecimal(dms, ref) {
      if (!dms || dms.length !== 3) return null;
      const [d, m, s] = dms;
      let dec = d + m / 60 + s / 3600;
      if (ref === "S" || ref === "W") dec = -dec;
      return dec;
    }

    const latDms = gps[GPS_TAGS.GPSLatitude] ? readValue(gps[GPS_TAGS.GPSLatitude]) : null;
    const latRef = gps[GPS_TAGS.GPSLatitudeRef]
      ? readValue(gps[GPS_TAGS.GPSLatitudeRef])
      : null;
    const lonDms = gps[GPS_TAGS.GPSLongitude]
      ? readValue(gps[GPS_TAGS.GPSLongitude])
      : null;
    const lonRef = gps[GPS_TAGS.GPSLongitudeRef]
      ? readValue(gps[GPS_TAGS.GPSLongitudeRef])
      : null;
    const alt = gps[GPS_TAGS.GPSAltitude] ? readValue(gps[GPS_TAGS.GPSAltitude]) : null;
    const altRef = gps[GPS_TAGS.GPSAltitudeRef]
      ? readValue(gps[GPS_TAGS.GPSAltitudeRef])
      : 0;

    const latitude = dmsToDecimal(latDms, latRef);
    const longitude = dmsToDecimal(lonDms, lonRef);

    if (latitude === null || longitude === null) {
      return dateTimeOriginal ? { dateTimeOriginal } : null;
    }

    return {
      latitude,
      longitude,
      altitude: alt !== null ? (altRef === 1 ? -alt : alt) : null,
      dateTimeOriginal,
    };
  } catch (err) {
    console.warn("EXIF parse failed", err);
    return null;
  }
}
