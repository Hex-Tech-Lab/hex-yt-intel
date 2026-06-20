export interface SettingsPersistencePort {
  /**
   * Fetch an application setting by its key.
   */
  getAppSetting(key: string): Promise<any | null>;
}
