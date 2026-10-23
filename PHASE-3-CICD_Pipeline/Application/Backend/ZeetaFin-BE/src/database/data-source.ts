import { config as dotenvConfig } from 'dotenv';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database.config';

dotenvConfig();

export const AppDataSource = new DataSource(databaseOptions());
export default AppDataSource;
