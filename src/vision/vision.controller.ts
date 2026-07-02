import { Controller, Post, Body } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { VisionService } from './vision.service';

class ExtraerTextoDto {
  @IsString() @IsNotEmpty() base64: string;
  @IsString() @IsNotEmpty() mimeType: string;
}

@Controller('vision')
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Post('extraer-texto')
  async extraerTexto(@Body() dto: ExtraerTextoDto) {
    const texto = await this.visionService.extraerTexto(dto.base64, dto.mimeType);
    return { texto };
  }
}
