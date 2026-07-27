package com.debugsync.config;

import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Raises Jackson's default max-string-length from 20 MB to 50 MB.
 *
 * Large projects can exceed the 20 MB default when their file contents
 * are serialized as a single JSON string (e.g. session upload / save).
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonStringLengthCustomizer() {
        return builder -> builder.postConfigurer(objectMapper ->
            objectMapper.getFactory().setStreamReadConstraints(
                StreamReadConstraints.builder()
                    .maxStringLength(50_000_000) // 50 MB
                    .build()
            )
        );
    }
}
