import { Sensor } from '../types/sensor.js';
import { isDefined } from '../utilities/type-guards.js';

export interface CoarseLocation {
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly zipCode?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly description?: string;
  readonly additionalFields?: Record<string, string | number | boolean>;
}

export interface CoarseLocationSensorProps {
  readonly location: CoarseLocation;
}

export class CoarseLocationSensor implements Sensor {
  private readonly location: CoarseLocation;

  constructor(props?: CoarseLocationSensorProps) {
    this.location = props?.location ?? {};
  }

  public async sense(): Promise<string> {
    const location = this.formatLocation();
    return `Approximate coarse location: ${location}`;
  }

  private readonly formatLocation = (): string => {
    const placeParts = [
      this.readString(this.location.city),
      this.readString(this.location.state),
      this.readString(this.location.country),
      this.readString(this.location.zipCode),
    ];
    const extraParts = [
      this.formatCoordinate('latitude', this.location.latitude),
      this.formatCoordinate('longitude', this.location.longitude),
      this.readString(this.location.description),
      ...this.formatAdditionalFields(this.location.additionalFields),
    ];
    const parts = [...placeParts, ...extraParts].filter(isDefined);

    if (parts.length === 0) {
      return 'not configured';
    }

    return parts.join(', ');
  };

  private readonly formatCoordinate = (
    label: 'latitude' | 'longitude',
    value: number | undefined,
  ): string | undefined =>
    value === undefined || !Number.isFinite(value)
      ? undefined
      : `${label}: ${value}`;

  private readonly formatAdditionalFields = (
    fields: Record<string, string | number | boolean> | undefined,
  ): string[] => {
    if (!fields) {
      return [];
    }

    return Object.entries(fields).flatMap(([key, value]) => {
      const formattedValue =
        typeof value === 'string' ? this.readString(value) : String(value);
      return formattedValue ? [`${key}: ${formattedValue}`] : [];
    });
  };

  private readonly readString = (
    value: string | undefined,
  ): string | undefined => {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
}
