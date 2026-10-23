import { JwtModuleOptions } from '@nestjs/jwt';

export const jwtConfig: JwtModuleOptions = {
  secret: process.env.JWT_SECRET || 'zeetafin-secret-key-change-in-production',
  signOptions: { expiresIn: '8h' },
};
