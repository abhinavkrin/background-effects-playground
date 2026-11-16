import { num } from '../../lib/params';
import { Background, type BackgroundSetting } from '../../passes/background';
import { COMPOSITE_DEFAULTS, Composite, type ViewMode } from '../../passes/composite';
import { RenderTarget, bindTexture, createProgram, createVertexBuffer, glsl, initTexture, resetSharedState, useQuad, vertexShaderSource } from '../../passes/gl';
import { passById } from '../../passes';
import type { PassConfig, PassContext, PassInstance } from '../../passes/types';
import type { Strategy } from '../../strategies';

const copyFragment = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_mask;
  uniform int u_mode;
  uniform bool u_maskIsBackground;
  out vec4 fragColor;

  void main() {
    float raw = texture(u_mask, texCoords).r;
    // 0: copy as is; 1: the person's probability, for the raw-mask view.
    float value = u_mode == 1 && u_maskIsBackground ? 1.0 - raw : raw;
    fragColor = vec4(vec3(value), 1.0);
  }
`;

interface StageEntry {
	config: PassConfig;
	instance: PassInstance;
}

/**
 * The editable WebGL pipeline: the library's setupWebGL split into the passes a strategy lists. It owns
 * the WebGL2 context of `canvas`, which MediaPipe renders into as well.
 */
export class LabPipeline {
	readonly gl: WebGL2RenderingContext;

	private readonly vertexBuffer: WebGLBuffer;

	private readonly frameTexture: WebGLTexture;

	private readonly emptyMask: WebGLTexture;

	private readonly background: Background;

	private readonly composite: Composite;

	private readonly copyProgram: WebGLProgram;

	private readonly heldMask: RenderTarget;

	private readonly rawMask: RenderTarget;

	private maskStage: StageEntry[] = [];

	private frameStage: StageEntry[] = [];

	private strategy: Strategy | undefined;

	private currentMask: WebGLTexture | null = null;

	/** The frame already in frameTexture, so renderFrame does not upload it twice. */
	private uploadedFrame: VideoFrame | null = null;

	private size = { width: 0, height: 0, maskWidth: 1, maskHeight: 1, factor: 1 };

	constructor(private readonly canvas: OffscreenCanvas) {
		const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
		if (!gl) {
			throw new Error('WebGL2 is not available');
		}
		this.gl = gl;
		gl.disable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		this.vertexBuffer = createVertexBuffer(gl);
		this.frameTexture = initTexture(gl);
		this.emptyMask = initTexture(gl);
		// No mask yet: zero everywhere, which the composite reads as "all person", i.e. the frame as is.
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
		this.background = new Background(gl);
		this.composite = new Composite(gl);
		this.copyProgram = createProgram(gl, vertexShaderSource(false), copyFragment);
		this.heldMask = new RenderTarget(gl);
		this.rawMask = new RenderTarget(gl);
	}

	/** Applies a strategy; passes keep their state when only parameters changed. */
	setStrategy(strategy: Strategy): void {
		const sameShape = (entries: StageEntry[], configs: PassConfig[]) =>
			entries.length === configs.length && entries.every((entry, i) => entry.config.pass === configs[i].pass);
		const build = (configs: PassConfig[]) => configs.map((config) => ({ config, instance: passById(config.pass).create(this.gl) }));
		if (sameShape(this.maskStage, strategy.mask)) {
			this.maskStage.forEach((entry, i) => (entry.config = strategy.mask[i]));
		} else {
			this.maskStage.forEach((entry) => entry.instance.dispose());
			this.maskStage = build(strategy.mask);
		}
		if (sameShape(this.frameStage, strategy.frame)) {
			this.frameStage.forEach((entry, i) => (entry.config = strategy.frame[i]));
		} else {
			this.frameStage.forEach((entry) => entry.instance.dispose());
			this.frameStage = build(strategy.frame);
		}
		if (this.strategy && this.strategy.maskTargetEdge !== strategy.maskTargetEdge) {
			this.size.width = 0;
		}
		this.strategy = strategy;
	}

	setBackground(setting: BackgroundSetting): void {
		this.background.set(setting);
	}

	get backgroundDisabled(): boolean {
		return this.background.disabled;
	}

	/**
	 * Runs the mask stage on a fresh segmentation mask, which is only valid during this call. `frame` is the frame
	 * that was segmented: it is uploaded here so mask passes can read it, and renderFrame reuses the upload.
	 */
	updateMask(mask: WebGLTexture, maskIsBackground: boolean, keepRaw: boolean, frame: VideoFrame): void {
		const strategy = this.requireStrategy();
		if (strategy.glReset) {
			resetSharedState(this.gl);
		}
		this.ensureSize(this.canvas.width, this.canvas.height);
		this.uploadFrame(frame);
		const ctx = this.context(maskIsBackground);
		if (keepRaw) {
			this.copy(mask, this.rawMask, 1, maskIsBackground);
		}
		let texture = mask;
		for (const { config, instance } of this.maskStage) {
			if (config.enabled) {
				texture = instance.run(ctx, texture, config.params);
			}
		}
		if (texture === mask) {
			this.copy(mask, this.heldMask, 0, maskIsBackground);
			texture = this.heldMask.texture;
		}
		this.currentMask = texture;
	}

	/** Draws `frame` with the current mask to the canvas. */
	renderFrame(frame: VideoFrame, view: ViewMode): void {
		const strategy = this.requireStrategy();
		const gl = this.gl;
		if (strategy.glReset) {
			resetSharedState(gl);
		}
		const width = frame.displayWidth;
		const height = frame.displayHeight;
		this.ensureSize(this.canvas.width, this.canvas.height);
		if (this.uploadedFrame !== frame) {
			this.uploadFrame(frame);
		}
		this.uploadedFrame = null;
		const background = this.background.render(this.frameTexture, width, height, this.vertexBuffer);
		let mask = this.currentMask ?? this.emptyMask;
		if (this.currentMask) {
			const ctx = this.context(false);
			for (const { config, instance } of this.frameStage) {
				if (config.enabled) {
					mask = instance.run(ctx, mask, config.params);
				}
			}
		}
		this.composite.render({
			vertexBuffer: this.vertexBuffer,
			width,
			height,
			frame: this.frameTexture,
			background,
			backgroundDisabled: this.background.disabled,
			mask,
			raw: this.rawMask.width ? this.rawMask.texture : this.emptyMask,
			view,
			params: { ...COMPOSITE_DEFAULTS, ...strategy.composite },
		});
	}

	/** Forgets the mask history, so the next mask starts fresh. */
	resetHistory(): void {
		[...this.maskStage, ...this.frameStage].forEach((entry) => entry.instance.reset?.());
		this.currentMask = null;
	}

	dispose(): void {
		const gl = this.gl;
		[...this.maskStage, ...this.frameStage].forEach((entry) => entry.instance.dispose());
		this.maskStage = [];
		this.frameStage = [];
		this.background.dispose();
		this.composite.dispose();
		gl.deleteProgram(this.copyProgram);
		this.heldMask.dispose();
		this.rawMask.dispose();
		gl.deleteTexture(this.frameTexture);
		gl.deleteTexture(this.emptyMask);
		gl.deleteBuffer(this.vertexBuffer);
	}

	private requireStrategy(): Strategy {
		if (!this.strategy) {
			throw new Error('setStrategy first');
		}
		return this.strategy;
	}

	private ensureSize(width: number, height: number): void {
		if (width === this.size.width && height === this.size.height) {
			return;
		}
		const edge = num({ edge: this.requireStrategy().maskTargetEdge }, 'edge', 640);
		const factor = Math.max(1, Math.round(Math.max(width, height) / edge));
		this.size = {
			width,
			height,
			factor,
			maskWidth: Math.max(1, Math.round(width / factor)),
			maskHeight: Math.max(1, Math.round(height / factor)),
		};
		this.heldMask.ensure(this.size.maskWidth, this.size.maskHeight);
		this.rawMask.ensure(this.size.maskWidth, this.size.maskHeight);
		// The passes resize their own targets on their next run; the temporal pass drops its history then.
	}

	private context(maskIsBackground: boolean): PassContext {
		return {
			gl: this.gl,
			vertexBuffer: this.vertexBuffer,
			maskWidth: this.size.maskWidth,
			maskHeight: this.size.maskHeight,
			maskDownsampleFactor: this.size.factor,
			frameTexture: this.frameTexture,
			frameWidth: this.size.width,
			frameHeight: this.size.height,
			maskIsBackground,
		};
	}

	private uploadFrame(frame: VideoFrame): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
		this.uploadedFrame = frame;
	}

	private copy(source: WebGLTexture, target: RenderTarget, mode: number, maskIsBackground: boolean): void {
		const gl = this.gl;
		useQuad(gl, this.copyProgram, this.vertexBuffer);
		target.bind();
		bindTexture(gl, 0, source, gl.getUniformLocation(this.copyProgram, 'u_mask'));
		gl.uniform1i(gl.getUniformLocation(this.copyProgram, 'u_mode'), mode);
		gl.uniform1i(gl.getUniformLocation(this.copyProgram, 'u_maskIsBackground'), maskIsBackground ? 1 : 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}
}
