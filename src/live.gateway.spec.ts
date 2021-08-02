import { Test, TestingModule } from '@nestjs/testing';
import { LiveGateway } from './live.gateway';

describe('LiveGateway', () => {
  let gateway: LiveGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LiveGateway],
    }).compile();

    gateway = module.get<LiveGateway>(LiveGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
