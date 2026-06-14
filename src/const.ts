export const CARD_VERSION = '0.1.0';

export const DEFAULT_IMAGE = '/local/model_y.png';

/**
 * Complete default entity map for a Tesla Fleet "Model Y".
 *
 * IMPORTANT: Tesla Fleet entity IDs are NOT uniformly prefixed — ~30 live on
 * the bare device (e.g. `sensor.odometer`, `cover.sunroof`, the tyre sensors,
 * the rear seat heaters). These defaults are the exact live IDs. Users with a
 * differently-named vehicle override individual keys via `config.entities`.
 */
export const DEFAULT_ENTITIES = {
  // ── summary / battery ────────────────────────────────────────────────
  battery_level: 'sensor.garage_model_y_battery_level',
  battery_range: 'sensor.garage_model_y_battery_range',
  usable_battery_level: 'sensor.usable_battery_level',
  ideal_battery_range: 'sensor.ideal_battery_range',
  estimate_battery_range: 'sensor.estimate_battery_range',
  odometer: 'sensor.odometer',
  shift_state: 'sensor.shift_state',
  update: 'update.garage_model_y_update',
  status: 'binary_sensor.garage_model_y_status',
  user_present: 'binary_sensor.garage_model_y_user_present',
  // ── lock + closures ──────────────────────────────────────────────────
  lock: 'lock.garage_model_y_lock',
  frunk: 'cover.garage_model_y_frunk',
  trunk: 'cover.garage_model_y_trunk',
  windows: 'cover.garage_model_y_windows',
  sunroof: 'cover.sunroof',
  door_fl: 'binary_sensor.garage_model_y_front_driver_door',
  door_fr: 'binary_sensor.garage_model_y_front_passenger_door',
  door_rl: 'binary_sensor.garage_model_y_rear_driver_door',
  door_rr: 'binary_sensor.garage_model_y_rear_passenger_door',
  window_fl: 'binary_sensor.garage_model_y_front_driver_window',
  window_fr: 'binary_sensor.garage_model_y_front_passenger_window',
  window_rl: 'binary_sensor.garage_model_y_rear_driver_window',
  window_rr: 'binary_sensor.garage_model_y_rear_passenger_window',
  // ── climate ──────────────────────────────────────────────────────────
  climate: 'climate.garage_model_y_climate',
  inside_temp: 'sensor.garage_model_y_inside_temperature',
  outside_temp: 'sensor.garage_model_y_outside_temperature',
  driver_temp_setting: 'sensor.driver_temperature_setting',
  passenger_temp_setting: 'sensor.passenger_temperature_setting',
  preconditioning: 'binary_sensor.preconditioning',
  preconditioning_enabled: 'binary_sensor.preconditioning_enabled',
  defrost: 'switch.garage_model_y_defrost',
  cabin_overheat_protection: 'climate.cabin_overheat_protection',
  cop_actively_cooling: 'binary_sensor.cabin_overheat_protection_actively_cooling',
  seat_fl: 'select.garage_model_y_seat_heater_front_left',
  seat_fr: 'select.garage_model_y_seat_heater_front_right',
  seat_rl: 'select.seat_heater_rear_left',
  seat_rc: 'select.seat_heater_rear_center',
  seat_rr: 'select.seat_heater_rear_right',
  steering_wheel_heater: 'select.garage_model_y_steering_wheel_heater',
  auto_seat_left: 'switch.garage_model_y_auto_seat_climate_left',
  auto_seat_right: 'switch.garage_model_y_auto_seat_climate_right',
  auto_steering_wheel: 'switch.garage_model_y_auto_steering_wheel_heater',
  // ── charging ─────────────────────────────────────────────────────────
  charge_switch: 'switch.garage_model_y_charge',
  charge_limit: 'number.garage_model_y_charge_limit',
  charge_current: 'number.garage_model_y_charge_current',
  charger_voltage: 'sensor.garage_model_y_charger_voltage',
  charger_current: 'sensor.garage_model_y_charger_current',
  charger_power: 'sensor.garage_model_y_charger_power',
  charge_rate: 'sensor.garage_model_y_charge_rate',
  charge_energy_added: 'sensor.garage_model_y_charge_energy_added',
  time_to_full_charge: 'sensor.garage_model_y_time_to_full_charge',
  charging_status: 'sensor.garage_model_y_charging',
  charge_port: 'cover.garage_model_y_charge_port_door',
  charge_cable: 'binary_sensor.garage_model_y_charge_cable',
  charge_cable_lock: 'lock.garage_model_y_charge_cable_lock',
  scheduled_charging_pending: 'binary_sensor.scheduled_charging_pending',
  trip_charging: 'binary_sensor.trip_charging',
  charger_has_multiple_phases: 'binary_sensor.charger_has_multiple_phases',
  battery_heater: 'binary_sensor.battery_heater',
  charge_at_arrival: 'sensor.state_of_charge_at_arrival',
  // ── security ─────────────────────────────────────────────────────────
  sentry: 'switch.garage_model_y_sentry_mode',
  dashcam: 'binary_sensor.dashcam',
  // ── tyres ────────────────────────────────────────────────────────────
  tire_fl: 'sensor.tire_pressure_front_left',
  tire_fr: 'sensor.tire_pressure_front_right',
  tire_rl: 'sensor.tire_pressure_rear_left',
  tire_rr: 'sensor.tire_pressure_rear_right',
  tire_warn_fl: 'binary_sensor.tire_pressure_warning_front_left',
  tire_warn_fr: 'binary_sensor.tire_pressure_warning_front_right',
  tire_warn_rl: 'binary_sensor.tire_pressure_warning_rear_left',
  tire_warn_rr: 'binary_sensor.tire_pressure_warning_rear_right',
  // ── location / drive ─────────────────────────────────────────────────
  location: 'device_tracker.garage_model_y_location',
  route: 'device_tracker.garage_model_y_route',
  speed: 'sensor.speed',
  power: 'sensor.power',
  traffic_delay: 'sensor.traffic_delay',
  distance_to_arrival: 'sensor.garage_model_y_distance_to_arrival',
  time_to_arrival: 'sensor.garage_model_y_time_to_arrival',
  // ── media ────────────────────────────────────────────────────────────
  media_player: 'media_player.garage_model_y_media_player',
  // ── command buttons ──────────────────────────────────────────────────
  wake: 'button.garage_model_y_wake',
  honk: 'button.garage_model_y_honk_horn',
  flash: 'button.garage_model_y_flash_lights',
  homelink: 'button.garage_model_y_homelink',
  keyless: 'button.garage_model_y_keyless_driving',
  boombox: 'button.garage_model_y_play_fart',
} as const;

export type EntityKey = keyof typeof DEFAULT_ENTITIES;
