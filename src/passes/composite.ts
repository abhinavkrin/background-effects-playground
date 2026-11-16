import type { ParamSpec, Params } from '../lib/params';
import { bool, num } from '../lib/params';
import { bindTexture, createProgram, glsl, useQuad, vertexShaderSource } from './gl';

/** What a lab pane draws: the effect, or one of the debug views. */
export type ViewMode = 'effect' | 'raw-mask' | 'refined-mask' | 'overlay' | 'frame';

export const VIEW_MODES: ReadonlyArray<{ id: ViewMode; label: string }> = [
	{ id: 'effect', label: 'Effect' },
	{ id: 'raw-mask', label: 'Raw mask (model output)' },
	{ id: 'refined-mask', label: 'Refined mask (what the composite uses)' },
	{ id: 'overlay', label: 'Mask overlay on frame' },
	{ id: 'frame', label: 'Input frame' },
];

const VIEW_INDEX: Record<ViewMode, number> = { effect: 0, 'raw-mask': 1, 'refined-mask': 2, overlay: 3, frame: 4 };

// The library's composite shader, with the debug views added as early outs. Mask views draw white for the person.
const fragment = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D background;
  uniform bool disableBackground;
  uniform sampler2D frame;
  uniform sampler2D mask;
  uniform sampler2D u_raw;
  uniform int u_view;
  uniform float u_edgeSoftness;
  uniform float u_edgeMinHalfWidth;
  uniform bool u_confidenceAsOpacity;
  out vec4 fragColor;

  void main() {
    vec4 frameTex = texture(frame, texCoords);
    if (u_view == 4) {
      fragColor = frameTex;
      return;
    }
    if (u_view == 1) {
      fragColor = vec4(vec3(texture(u_raw, texCoords).r), 1.0);
      return;
    }
    float maskVal = texture(mask, texCoords).r;
    if (u_view == 2) {
      fragColor = vec4(vec3(1.0 - maskVal), 1.0);
      return;
    }
    float grad = length(vec2(dFdx(maskVal), dFdy(maskVal)));
    // u_edgeMinHalfWidth 0 is the library; #135 uses 0.015 so a flat mask never gives a zero-width smoothstep.
    float halfWidth = max(u_edgeMinHalfWidth, grad * u_edgeSoftness);
    float smoothAlpha = u_confidenceAsOpacity ? maskVal : smoothstep(0.5 - halfWidth, 0.5 + halfWidth, maskVal);
    if (u_view == 3) {
      vec3 tinted = mix(frameTex.rgb, vec3(1.0, 0.1, 0.4), 0.55 * smoothAlpha);
      float edge = 1.0 - smoothstep(0.0, fwidth(maskVal) * 1.5 + 0.0001, abs(maskVal - 0.5));
      fragColor = vec4(mix(tinted, vec3(1.0, 0.95, 0.1), edge), 1.0);
      return;
    }
    if (disableBackground) {
      fragColor = frameTex;
    } else {
      vec4 bgTex = texture(background, texCoords);
      fragColor = mix(bgTex, vec4(frameTex.rgb, 1.0), 1.0 - smoothAlpha);
    }
  }
`;

export const COMPOSITE_PARAMS: readonly ParamSpec[] = [
	{ key: 'edgeSoftness', label: 'Edge feathering', kind: 'number', min: 0, max: 8, step: 0.25, help: 'Width of the smoothstep around the 0.5 cut, in mask gradients. Library: 2.' },
	{ key: 'edgeMinHalfWidth', label: 'Edge min half-width', kind: 'number', min: 0, max: 0.1, step: 0.005, help: 'Floor on the smoothstep half-width around 0.5. Library: 0; #135: 0.015.' },
	{ key: 'confidenceAsOpacity', label: 'Confidence as opacity', kind: 'boolean', help: 'Blend by the background probability itself instead of a cut at 0.5; the two edge settings above then do nothing.' },
];

export const COMPOSITE_DEFAULTS: Params = { edgeSoftness: 2, edgeMinHalfWidth: 0, confidenceAsOpacity: false };

/** Draws the final picture to the canvas: frame over background through the mask, or a debug view. */
export class Composite {
	private readonly program: WebGLProgram;

	private readonly uniforms;

	constructor(private readonly gl: WebGL2RenderingContext) {
		this.program = createProgram(gl, vertexShaderSource(true), fragment);
		this.uniforms = {
			background: gl.getUniformLocation(this.program, 'background'),
			disableBackground: gl.getUniformLocation(this.program, 'disableBackground'),
			frame: gl.getUniformLocation(this.program, 'frame'),
			mask: gl.getUniformLocation(this.program, 'mask'),
			raw: gl.getUniformLocation(this.program, 'u_raw'),
			view: gl.getUniformLocation(this.program, 'u_view'),
			edgeSoftness: gl.getUniformLocation(this.program, 'u_edgeSoftness'),
			edgeMinHalfWidth: gl.getUniformLocation(this.program, 'u_edgeMinHalfWidth'),
			confidenceAsOpacity: gl.getUniformLocation(this.program, 'u_confidenceAsOpacity'),
		};
	}

	render(args: {
		vertexBuffer: WebGLBuffer;
		width: number;
		height: number;
		frame: WebGLTexture;
		background: WebGLTexture;
		backgroundDisabled: boolean;
		mask: WebGLTexture;
		raw: WebGLTexture;
		view: ViewMode;
		params: Params;
	}): void {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, args.width, args.height);
		gl.clearColor(1, 1, 1, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		useQuad(gl, this.program, args.vertexBuffer);
		bindTexture(gl, 0, args.background, this.uniforms.background);
		gl.uniform1i(this.uniforms.disableBackground, args.backgroundDisabled ? 1 : 0);
		bindTexture(gl, 1, args.frame, this.uniforms.frame);
		bindTexture(gl, 2, args.mask, this.uniforms.mask);
		bindTexture(gl, 3, args.raw, this.uniforms.raw);
		gl.uniform1i(this.uniforms.view, VIEW_INDEX[args.view]);
		gl.uniform1f(this.uniforms.edgeSoftness, num(args.params, 'edgeSoftness', 2));
		gl.uniform1f(this.uniforms.edgeMinHalfWidth, num(args.params, 'edgeMinHalfWidth', 0));
		gl.uniform1i(this.uniforms.confidenceAsOpacity, bool(args.params, 'confidenceAsOpacity', false) ? 1 : 0);
		const blend = args.view === 'effect';
		if (blend) {
			gl.enable(gl.BLEND);
		}
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		if (blend) {
			gl.disable(gl.BLEND);
		}
	}

	dispose(): void {
		this.gl.deleteProgram(this.program);
	}
}
