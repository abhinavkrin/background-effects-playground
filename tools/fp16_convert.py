"""Rewrites a float32 TFLite model with float16 weights, decoded back to float32 by DEQUANTIZE ops at load time.

The same layout the TFLite converter produces for float16 quantization; MediaPipe metadata is carried over untouched.
"""
import copy
import sys

import numpy as np
from tensorflow.lite.python import schema_py_generated as schema
from tensorflow.lite.tools import flatbuffer_utils

src, dst = sys.argv[1], sys.argv[2]
model = flatbuffer_utils.read_model(src)

FLOAT32 = schema.TensorType.FLOAT32
FLOAT16 = schema.TensorType.FLOAT16
DEQUANTIZE = schema.BuiltinOperator.DEQUANTIZE


def dequantize_opcode():
    for index, code in enumerate(model.operatorCodes):
        if max(code.builtinCode, code.deprecatedBuiltinCode) == DEQUANTIZE:
            code.version = max(code.version, 3)
            return index
    code = schema.OperatorCodeT()
    code.builtinCode = DEQUANTIZE
    code.deprecatedBuiltinCode = DEQUANTIZE
    # Version 3 is the one that takes float16 input.
    code.version = 3
    model.operatorCodes.append(code)
    return len(model.operatorCodes) - 1


opcode = dequantize_opcode()

# Buffers referenced by tensors in any subgraph, to free only those no other tensor still reads.
references = {}
for subgraph in model.subgraphs:
    for tensor in subgraph.tensors:
        references[tensor.buffer] = references.get(tensor.buffer, 0) + 1

converted = 0
saved = 0
for subgraph in model.subgraphs:
    decoders = []
    for index, tensor in enumerate(list(subgraph.tensors)):
        if tensor.type != FLOAT32:
            continue
        buffer = model.buffers[tensor.buffer]
        if buffer.data is None or len(buffer.data) == 0:
            continue
        values = np.frombuffer(bytes(buffer.data), dtype=np.float32)
        half = values.astype(np.float16)

        packed = schema.BufferT()
        packed.data = np.frombuffer(half.tobytes(), dtype=np.uint8)
        model.buffers.append(packed)

        weights = copy.deepcopy(tensor)
        weights.type = FLOAT16
        weights.buffer = len(model.buffers) - 1
        weights.name = (tensor.name or b'') + b'_fp16'
        subgraph.tensors.append(weights)

        references[tensor.buffer] -= 1
        if references[tensor.buffer] == 0:
            buffer.data = None
        # Buffer 0 is the empty one: the tensor is now computed, not stored.
        tensor.buffer = 0

        decoder = schema.OperatorT()
        decoder.opcodeIndex = opcode
        decoder.inputs = np.array([len(subgraph.tensors) - 1], dtype=np.int32)
        decoder.outputs = np.array([index], dtype=np.int32)
        decoders.append(decoder)

        converted += 1
        saved += values.nbytes - half.nbytes
    subgraph.operators = decoders + list(subgraph.operators)

flatbuffer_utils.write_model(model, dst)
print(f'converted {converted} weight tensors, {saved / 1024 / 1024:.1f} MB saved')

# MediaPipe keeps the model's associated files (labels.txt) in a zip appended after the flatbuffer, which
# write_model does not carry over.
import zipfile

with zipfile.ZipFile(src) as source:
    with zipfile.ZipFile(dst, 'a', compression=zipfile.ZIP_STORED) as target:
        for name in source.namelist():
            target.writestr(name, source.read(name))
        print('carried over', source.namelist())
