module latch_demo (
    input  wire [1:0] sel,
    input  wire [3:0] a,
    input  wire [3:0] b,
    output reg  [3:0] y
);

    // Flaw: case without default in combinational logic infers a latch.
    always @(*) begin
        case (sel)
            2'b00: y = a;
            2'b01: y = b;
        endcase
    end

endmodule
