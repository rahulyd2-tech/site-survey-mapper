// Parser for DJI Air 3 .SRT telemetry sidecar files. Each block looks like:
//
// 1
// 00:00:00,000 --> 00:00:00,016
// <font size="28">FrameCnt: 1, DiffTime: 16ms
// 2024-12-21 16:09:50.545
// [iso: 100] [shutter: 1/2500.0] [fnum: 1.7] [ev: 0] [color_md: default]
// [focal_len: 24.00] [latitude: 18.123853] [longitude: 74.184650]
// [rel_alt: 4.100 abs_alt: 628.528] [ct: 4587] </font>
//
// parseDjiSrt() returns { frames, summary, simplifiedPath } where frames is
// every parsed sample and simplifiedPath is a decimated [lat,lon] polyline
// small enough to store in a Google Sheets cell.

function parseDjiSrt(text) {
  const blocks = text.split(/\r?\n\r?\n/).filter((b) => b.trim());
  const frames = [];

  const numRe = (name) => new RegExp(`\\[${name}:\\s*([\\-0-9.]+)\\]`);
  const shutterRe = /\[shutter:\s*([^\]]+)\]/;
  const relAbsRe = /\[rel_alt:\s*([\-0-9.]+)\s+abs_alt:\s*([\-0-9.]+)\]/;
  const dateRe = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/;
  const frameCntRe = /FrameCnt:\s*(\d+)/;

  for (const block of blocks) {
    const frameCntMatch = block.match(frameCntRe);
    const dateMatch = block.match(dateRe);
    const latMatch = block.match(numRe("latitude"));
    const lonMatch = block.match(numRe("longitude"));
    const relAbsMatch = block.match(relAbsRe);
    if (!latMatch || !lonMatch) continue;

    const isoMatch = block.match(numRe("iso"));
    const fnumMatch = block.match(numRe("fnum"));
    const focalMatch = block.match(numRe("focal_len"));
    const ctMatch = block.match(numRe("ct"));
    const shutterMatch = block.match(shutterRe);

    frames.push({
      frameCnt: frameCntMatch ? parseInt(frameCntMatch[1], 10) : null,
      timestamp: dateMatch ? dateMatch[1] : null,
      latitude: parseFloat(latMatch[1]),
      longitude: parseFloat(lonMatch[1]),
      relAlt: relAbsMatch ? parseFloat(relAbsMatch[1]) : null,
      absAlt: relAbsMatch ? parseFloat(relAbsMatch[2]) : null,
      iso: isoMatch ? parseFloat(isoMatch[1]) : null,
      shutter: shutterMatch ? shutterMatch[1].trim() : null,
      fnum: fnumMatch ? parseFloat(fnumMatch[1]) : null,
      focalLen: focalMatch ? parseFloat(focalMatch[1]) : null,
      colorTemp: ctMatch ? parseFloat(ctMatch[1]) : null,
    });
  }

  if (!frames.length) {
    throw new Error("No telemetry frames found — is this a DJI .SRT file?");
  }

  const lats = frames.map((f) => f.latitude);
  const lons = frames.map((f) => f.longitude);
  const relAlts = frames.filter((f) => f.relAlt !== null).map((f) => f.relAlt);
  const absAlts = frames.filter((f) => f.absAlt !== null).map((f) => f.absAlt);

  const first = frames[0];
  const last = frames[frames.length - 1];

  const summary = {
    frameCount: frames.length,
    startTime: first.timestamp,
    endTime: last.timestamp,
    durationSec: durationBetween(first.timestamp, last.timestamp),
    bbox: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    },
    startLatLon: [first.latitude, first.longitude],
    endLatLon: [last.latitude, last.longitude],
    relAlt: minMaxAvg(relAlts),
    absAlt: minMaxAvg(absAlts),
  };

  const simplifiedPath = decimatePath(
    frames.map((f) => [f.latitude, f.longitude]),
    300
  );

  return { frames, summary, simplifiedPath };
}

function durationBetween(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr.replace(" ", "T") + "Z").getTime();
  const end = new Date(endStr.replace(" ", "T") + "Z").getTime();
  return Math.round((end - start) / 1000);
}

function minMaxAvg(arr) {
  if (!arr.length) return { min: null, max: null, avg: null };
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...arr),
    max: Math.max(...arr),
    avg: Math.round((sum / arr.length) * 1000) / 1000,
  };
}

// Evenly-spaced decimation to at most maxPoints — keeps flight-path payload
// small enough for a Sheets cell while preserving overall shape.
function decimatePath(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.floor(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}
