import { Controller, Post, Body } from '@nestjs/common';
import { IsString, IsNotEmpty, IsNumber, IsArray, IsOptional } from 'class-validator';
import { AiService } from './ai.service';

class PorTipoDto {
  label: string;
  count: number;
  total: number;
}

class DesgloseDto {
  metodo: string;
  count: number;
  total: number;
}

class ResumenCierreDto {
  @IsNumber() totalVentas: number;
  @IsNumber() totalPedidos: number;
  @IsArray() porTipo: PorTipoDto[];
  @IsArray() desglose: DesgloseDto[];
  @IsNumber() efectivoSistema: number;
  @IsOptional() diferencia: number | null;
  @IsString() @IsNotEmpty() cajeroNombre: string;
}

class DescripcionProductoDto {
  @IsString() @IsNotEmpty() nombre: string;
  @IsString() @IsNotEmpty() categoria: string;
  @IsNumber() precio: number;
}

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('resumen-cierre')
  async resumenCierre(@Body() dto: ResumenCierreDto) {
    const texto = await this.aiService.resumirCierre(dto);
    return { texto };
  }

  @Post('descripcion-producto')
  async descripcionProducto(@Body() dto: DescripcionProductoDto) {
    const texto = await this.aiService.generarDescripcionProducto(dto);
    return { texto };
  }
}
