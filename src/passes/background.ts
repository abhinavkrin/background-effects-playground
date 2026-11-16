import { RenderTarget, bindTexture, createProgram, glsl, initTexture, useQuad, vertexShaderSource } from './gl';

// The library's background: a quarter-size Gaussian blur of the frame, or an image cropped to cover the canvas
// (src/webgl/index.ts, shader-programs/blurShader.ts and downSampler.ts in @livekit/track-processors).

const GAUSSIAN_MAX_RADIUS = 16;
const GAUSSIAN_MAX_TAPS = 1 + Math.ceil(GAUSSIAN_MAX_RADIUS / 2);
const DOWNSAMPLE_FACTOR = 4;

const blurFragment = glsl`#version 300 es
  precision mediump float;
  const int MAX_TAPS = ${GAUSSIAN_MAX_TAPS};
  in vec2 texCoords;
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  uniform vec2 u_direction;
  uniform float u_weights[MAX_TAPS];
  uniform float u_offsets[MAX_TAPS];
  uniform int u_tapCount;
  out vec4 fragColor;

  void main() {
    vec3 result = texture(u_texture, texCoords).rgb * u_weights[0];

    for (int i = 1; i < MAX_TAPS; ++i) {
      if (i >= u_tapCount) break;
      vec2 offset = u_direction * u_texelSize * u_offsets[i];
      result += (texture(u_texture, texCoords + offset).rgb + texture(u_texture, texCoords - offset).rgb) * u_weights[i];
    }

    fragColor = vec4(result, 1.0);
  }
`;

const downsampleVertex = `
  attribute vec2 position;
  varying vec2 v_uv;
  void main() {
    v_uv = (position + 1.0) * 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const downsampleFragment = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  void main() {
    gl_FragColor = texture2D(u_texture, v_uv);
  }
`;

const computeGaussianKernel = (blurRadius: number) => {
	const sigma = blurRadius;
	const radius = Math.min(GAUSSIAN_MAX_RADIUS, Math.ceil(blurRadius));
	const weightAt = (offset: number) => Math.exp(-(offset * offset) / (2 * sigma * sigma));
	const weights = new Float32Array(GAUSSIAN_MAX_TAPS);
	const offsets = new Float32Array(GAUSSIAN_MAX_TAPS);
	weights[0] = weightAt(0);
	let total = weights[0];
	let tapCount = 1;
	for (let i = 1; i <= radius; i += 2) {
		const w1 = weightAt(i);
		const w2 = i + 1 <= radius ? weightAt(i + 1) : 0;
		const pairWeight = w1 + w2;
		weights[tapCount] = pairWeight;
		offsets[tapCount] = (i * w1 + (i + 1) * w2) / pairWeight;
		total += 2 * pairWeight;
		tapCount += 1;
	}
	for (let i = 0; i < tapCount; i++) {
		weights[i] /= total;
	}
	return { weights, offsets, tapCount };
};

const resizeImageToCover = (image: ImageBitmap, targetWidth: number, targetHeight: number): Promise<ImageBitmap> => {
	const imgAspect = image.width / image.height;
	const targetAspect = targetWidth / targetHeight;
	let sx = 0;
	let sy = 0;
	let sWidth = image.width;
	let sHeight = image.height;
	if (imgAspect > targetAspect) {
		sWidth = Math.round(image.height * targetAspect);
		sx = Math.round((image.width - sWidth) / 2);
	} else if (imgAspect < targetAspect) {
		sHeight = Math.round(image.width / targetAspect);
		sy = Math.round((image.height - sHeight) / 2);
	}
	return createImageBitmap(image, sx, sy, sWidth, sHeight, { resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: 'medium' });
};

/** What goes behind the person. */
export type BackgroundSetting = { mode: 'blur'; radius: number } | { mode: 'image'; url: string } | { mode: 'none' };

export class Background {
	private readonly blurProgram: WebGLProgram;

	private readonly downsampleProgram: WebGLProgram;

	private readonly downsampled: RenderTarget;

	private readonly blurTargets: [RenderTarget, RenderTarget];

	private readonly imageTexture: WebGLTexture;

	private readonly blurUniforms;

	private kernelRadius: number | null = null;

	private blurRadius: number | null = null;

	private image: ImageBitmap | null = null;

	private imageSize = { width: 0, height: 0 };

	private imageRequest = 0;

	constructor(private readonly gl: WebGL2RenderingContext) {
		this.blurProgram = createProgram(gl, vertexShaderSource(), blurFragment);
		this.downsampleProgram = createProgram(gl, downsampleVertex, downsampleFragment);
		this.downsampled = new RenderTarget(gl);
		this.blurTargets = [new RenderTarget(gl), new RenderTarget(gl)];
		this.imageTexture = initTexture(gl);
		this.blurUniforms = {
			texture: gl.getUniformLocation(this.blurProgram, 'u_texture'),
			texelSize: gl.getUniformLocation(this.blurProgram, 'u_texelSize'),
			direction: gl.getUniformLocation(this.blurProgram, 'u_direction'),
			weights: gl.getUniformLocation(this.blurProgram, 'u_weights'),
			offsets: gl.getUniformLocation(this.blurProgram, 'u_offsets'),
			tapCount: gl.getUniformLocation(this.blurProgram, 'u_tapCount'),
		};
		this.uploadEmpty();
	}

	get disabled(): boolean {
		return this.blurRadius === null && !this.image;
	}

	/** Applies a background; an image is loaded and cropped asynchronously, transparent until then. */
	async set(setting: BackgroundSetting, width: number, height: number): Promise<void> {
		const request = ++this.imageRequest;
		if (setting.mode === 'blur') {
			this.blurRadius = setting.radius ? Math.max(1, Math.floor(setting.radius / DOWNSAMPLE_FACTOR)) : null;
			this.replaceImage(null);
			return;
		}
		this.blurRadius = null;
		if (setting.mode === 'none') {
			this.replaceImage(null);
			return;
		}
		let bitmap: ImageBitmap;
		try {
			const response = await fetch(setting.url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			bitmap = await createImageBitmap(await response.blob());
		} catch (e) {
			console.error(`background image ${setting.url}:`, e);
			if (request === this.imageRequest) {
				this.replaceImage(null);
			}
			return;
		}
		if (request !== this.imageRequest) {
			bitmap.close();
			return;
		}
		this.replaceImage(bitmap);
		this.uploadEmpty();
		await this.fitImage(width, height);
	}

	/** Produces the background texture for a frame already uploaded to `frameTexture`. */
	render(frameTexture: WebGLTexture, width: number, height: number, vertexBuffer: WebGLBuffer): WebGLTexture {
		const gl = this.gl;
		if (this.image && (this.imageSize.width !== width || this.imageSize.height !== height)) {
			void this.fitImage(width, height);
		}
		if (!this.blurRadius) {
			return this.imageTexture;
		}
		const w = Math.max(1, Math.floor(width / DOWNSAMPLE_FACTOR));
		const h = Math.max(1, Math.floor(height / DOWNSAMPLE_FACTOR));
		this.downsampled.ensure(w, h);
		this.blurTargets.forEach((target) => target.ensure(w, h));

		useQuad(gl, this.downsampleProgram, vertexBuffer);
		this.downsampled.bind();
		bindTexture(gl, 0, frameTexture, gl.getUniformLocation(this.downsampleProgram, 'u_texture'));
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		useQuad(gl, this.blurProgram, vertexBuffer);
		if (this.kernelRadius !== this.blurRadius) {
			const kernel = computeGaussianKernel(this.blurRadius);
			gl.uniform1fv(this.blurUniforms.weights, kernel.weights);
			gl.uniform1fv(this.blurUniforms.offsets, kernel.offsets);
			gl.uniform1i(this.blurUniforms.tapCount, kernel.tapCount);
			this.kernelRadius = this.blurRadius;
		}
		gl.uniform2f(this.blurUniforms.texelSize, 1 / w, 1 / h);
		this.blurTargets[0].bind();
		bindTexture(gl, 0, this.downsampled.texture, this.blurUniforms.texture);
		gl.uniform2f(this.blurUniforms.direction, 1, 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		this.blurTargets[1].bind();
		bindTexture(gl, 0, this.blurTargets[0].texture, this.blurUniforms.texture);
		gl.uniform2f(this.blurUniforms.direction, 0, 1);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return this.blurTargets[1].texture;
	}

	dispose(): void {
		const gl = this.gl;
		gl.deleteProgram(this.blurProgram);
		gl.deleteProgram(this.downsampleProgram);
		this.downsampled.dispose();
		this.blurTargets.forEach((target) => target.dispose());
		gl.deleteTexture(this.imageTexture);
		this.replaceImage(null);
	}

	private uploadEmpty(): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, new ImageData(2, 2));
	}

	private replaceImage(image: ImageBitmap | null): void {
		this.image?.close();
		this.image = image;
	}

	private async fitImage(width: number, height: number): Promise<void> {
		const image = this.image;
		if (!image || width === 0 || height === 0) {
			return;
		}
		this.imageSize = { width, height };
		let cropped: ImageBitmap;
		try {
			cropped = await resizeImageToCover(image, width, height);
		} catch {
			// The image was replaced and closed while it was being cropped.
			return;
		}
		if (this.image !== image) {
			cropped.close();
			return;
		}
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cropped);
		cropped.close();
	}
}
