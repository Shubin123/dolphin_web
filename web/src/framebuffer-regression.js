// Pure RGBA comparison, shared by browser regression tools and unit tests.
export function compareFramebuffers(expected, actual, { channelTolerance = 2, maxChangedFraction = 0.005 } = {}) {
  if (!Number.isFinite(channelTolerance) || channelTolerance < 0 || channelTolerance > 255 ||
      !Number.isFinite(maxChangedFraction) || maxChangedFraction < 0 || maxChangedFraction > 1) {
    throw new Error('Invalid framebuffer comparison tolerance');
  }
  for (const frame of [expected, actual]) {
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0 ||
        frame.data?.length !== frame.width * frame.height * 4) throw new Error('Invalid RGBA framebuffer');
  }
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { passed: false, reason: 'dimensions differ' };
  }
  let changed = 0, sum = 0, squaredSum = 0, absoluteError = 0;
  const count = actual.width * actual.height;
  for (let i = 0; i < actual.data.length; i += 4) {
    let differs = false;
    for (let c = 0; c < 3; c++) {
      const error = Math.abs(expected.data[i + c] - actual.data[i + c]);
      differs ||= error > channelTolerance;
      absoluteError += error;
    }
    if (differs) changed++;
    const luminance = (actual.data[i] + actual.data[i + 1] + actual.data[i + 2]) / 3;
    sum += luminance;
    squaredSum += luminance * luminance;
  }
  const deviation = Math.sqrt(Math.max(0, squaredSum / count - (sum / count) ** 2));
  const changedFraction = changed / count;
  return {
    passed: deviation > 5 && changedFraction <= maxChangedFraction,
    reason: deviation <= 5 ? 'blank or uniform framebuffer' : changedFraction > maxChangedFraction ? 'pixels differ' : 'matched',
    changedFraction, meanAbsoluteError: absoluteError / (count * 3), luminanceDeviation: deviation
  };
}
