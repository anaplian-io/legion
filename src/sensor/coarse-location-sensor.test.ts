import { describe, expect, it } from 'vitest';
import { CoarseLocationSensor } from './coarse-location-sensor.js';

describe('CoarseLocationSensor', () => {
  it('should format a city, state, country, and zipCode location', async () => {
    const sensor = new CoarseLocationSensor({
      location: {
        city: 'Brooklyn',
        state: 'NY',
        country: 'USA',
        zipCode: '11201',
      },
    });

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: Brooklyn, NY, USA, 11201',
    );
  });

  it('should omit missing or blank fields', async () => {
    const sensor = new CoarseLocationSensor({
      location: {
        city: '  Toronto ',
        state: '',
        country: ' Canada ',
      },
    });

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: Toronto, Canada',
    );
  });

  it('should include finite latitude and longitude when provided', async () => {
    const sensor = new CoarseLocationSensor({
      location: {
        city: 'Brooklyn',
        latitude: 40.6782,
        longitude: -73.9442,
      },
    });

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: Brooklyn, latitude: 40.6782, longitude: -73.9442',
    );
  });

  it('should omit non-finite coordinates', async () => {
    const sensor = new CoarseLocationSensor({
      location: {
        latitude: Number.NaN,
        longitude: Number.POSITIVE_INFINITY,
        description: 'near Prospect Park',
      },
    });

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: near Prospect Park',
    );
  });

  it('should include additional fields after standard fields', async () => {
    const sensor = new CoarseLocationSensor({
      location: {
        city: 'Brooklyn',
        additionalFields: {
          borough: 'Brooklyn',
          timezoneOffsetMinutes: -240,
          daylightSavingTime: true,
          blank: '   ',
        },
      },
    });

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: Brooklyn, borough: Brooklyn, timezoneOffsetMinutes: -240, daylightSavingTime: true',
    );
  });

  it('should report an unconfigured location when no usable fields are provided', async () => {
    const sensor = new CoarseLocationSensor({
      location: {
        city: '',
      },
    });

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: not configured',
    );
  });

  it('should report an unconfigured location when constructed without props', async () => {
    const sensor = new CoarseLocationSensor();

    await expect(sensor.sense()).resolves.toBe(
      'Approximate coarse location: not configured',
    );
  });
});
